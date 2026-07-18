import { useCallback, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  DEFAULT_NETWORKS,
  NETWORK_META,
  type DerivedWallet,
  type NetworkId,
} from './lib/types';
import { buildWalletsFromText, scanBalances, type InputMode } from './lib/scan';

type Filter = 'all' | 'funded' | 'alive' | 'empty' | 'err';

function shortAddr(a: string) {
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

export default function App() {
  const [text, setText] = useState('');
  const [networks, setNetworks] = useState<NetworkId[]>([...DEFAULT_NETWORKS]);
  const [wallets, setWallets] = useState<DerivedWallet[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  const fileRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const funded = wallets.filter((w) => w.hasAnyFunds).length;
    const alive = wallets.filter((w) => w.isAlive).length;
    const errors = wallets.filter(
      (w) => w.kind === 'invalid' || w.balances.some((b) => b.status === 'error')
    ).length;
    return { total: wallets.length, funded, alive, errors };
  }, [wallets]);

  const visible = useMemo(() => {
    let list = [...wallets];
    if (filter === 'funded') list = list.filter((w) => w.hasAnyFunds);
    if (filter === 'alive') list = list.filter((w) => w.isAlive);
    if (filter === 'empty')
      list = list.filter((w) => !w.isAlive && w.kind !== 'invalid');
    if (filter === 'err')
      list = list.filter(
        (w) => w.kind === 'invalid' || w.balances.some((b) => b.status === 'error')
      );
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (w) =>
          w.rawLine.toLowerCase().includes(s) ||
          Object.values(w.addresses).some((a) => a?.toLowerCase().includes(s))
      );
    }
    list.sort(
      (a, b) =>
        Number(b.hasAnyFunds) - Number(a.hasAnyFunds) ||
        b.totalHits - a.totalHits ||
        Number(b.isAlive) - Number(a.isAlive)
    );
    return list;
  }, [wallets, filter, q]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const chunks: string[] = [];
    for (const file of Array.from(files)) chunks.push(await file.text());
    setText((prev) => [prev, ...chunks].filter(Boolean).join('\n'));
  };

  const runScan = useCallback(async () => {
    setError(null);
    const current = buildWalletsFromText(text, networks, { inputMode });
    setWallets(current);
    if (!current.length) {
      setError('пусто');
      return;
    }
    setScanning(true);
    setProgress({ done: 0, total: 0 });
    try {
      await scanBalances(current, {
        concurrency: 8,
        onUpdate: setWallets,
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [text, networks, inputMode]);

  const toggleNetwork = (id: NetworkId) => {
    setNetworks((prev) =>
      prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]
    );
  };

  const exportCsv = () => {
    const rows = [['raw', 'kind', 'network', 'address', 'balance', 'received', 'tx', 'status']];
    for (const w of wallets) {
      for (const b of w.balances) {
        rows.push([
          w.rawLine,
          w.kind,
          b.network,
          b.address,
          b.balanceHuman,
          b.receivedAtomic ?? '',
          String(b.txCount ?? ''),
          b.status,
        ]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* ignore */
    }
  };

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="shell">
      <div className="glow" aria-hidden />
      <header className="top">
        <div className="logo">
          <span className="mark" />
          KEYFOLIO
        </div>
        <div className="top-stats">
          <b>{stats.total}</b>
          <span>keys</span>
          <b className="hot">{stats.funded}</b>
          <span>funded</span>
          <b>{stats.alive}</b>
          <span>alive</span>
        </div>
      </header>

      <section className="stage">
        <div className="ingest">
          <div className="ingest-bar">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              TXT
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept=".txt,.csv,.log,text/plain"
              onChange={(e) => onFiles(e.target.files)}
            />
            {(
              [
                ['normal', 'NORMAL', 'hex / WIF / address'],
                ['brain', 'BRAIN', 'SHA256(input) → private key'],
                ['both', 'BOTH', 'normal + SHA256(input)'],
              ] as const
            ).map(([mode, label, title]) => (
              <button
                key={mode}
                type="button"
                className={inputMode === mode ? 'btn active' : 'btn'}
                disabled={scanning}
                onClick={() => setInputMode(mode)}
                title={title}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="btn primary"
              disabled={scanning || !text.trim()}
              onClick={runScan}
            >
              {scanning ? `${pct}%` : 'SCAN'}
            </button>
            <button type="button" className="btn" disabled={!wallets.length} onClick={exportCsv}>
              CSV
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              inputMode === 'brain'
                ? 'passphrase / hash — по строке (SHA256 → key)'
                : inputMode === 'both'
                  ? 'hex / WIF / address — normal + brainwallet'
                  : 'hex / WIF / address — по строке'
            }
            spellCheck={false}
          />
          {scanning && (
            <div className="bar">
              <i style={{ width: `${pct}%` }} />
            </div>
          )}
          {error && <div className="err">{error}</div>}
        </div>

        <div className="nets">
          {DEFAULT_NETWORKS.map((id) => (
            <button
              key={id}
              type="button"
              className={networks.includes(id) ? 'pill on' : 'pill'}
              onClick={() => toggleNetwork(id)}
            >
              {NETWORK_META[id].short}
            </button>
          ))}
        </div>
      </section>

      {wallets.length > 0 && (
        <section className="board">
          <div className="board-bar">
            <div className="filters">
              {(
                [
                  ['all', 'all'],
                  ['funded', 'funded'],
                  ['alive', 'alive'],
                  ['empty', 'empty'],
                  ['err', 'err'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={filter === id ? 'pill on' : 'pill'}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter"
            />
          </div>

          <div className="list">
            {visible.map((w) => (
              <article
                key={w.id}
                className={`row ${w.hasAnyFunds ? 'hit' : ''} ${w.kind === 'invalid' ? 'bad' : ''}`}
              >
                <div className="row-head">
                  <button type="button" className="raw" onClick={() => copy(w.rawLine)} title="copy">
                    {shortAddr(w.rawLine)}
                  </button>
                  <div className="tags">
                    <span>{w.kind.replace('privkey_', '')}</span>
                    {w.hasAnyFunds && <span className="tag-hit">$$$</span>}
                    {w.isAlive && !w.hasAnyFunds && <span>alive</span>}
                  </div>
                </div>
                <div className="cells">
                  {w.balances.map((b) => (
                    <a
                      key={`${w.id}-${b.network}`}
                      className={`cell ${b.status} ${
                        b.status === 'ok' && BigInt(b.balanceAtomic || '0') > 0n ? 'plus' : ''
                      }`}
                      href={b.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={b.address}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        void copy(b.address);
                      }}
                    >
                      <em>{NETWORK_META[b.network].short}</em>
                      <strong>
                        {b.status === 'loading' && '…'}
                        {b.status === 'idle' && '—'}
                        {b.status === 'ok' && b.balanceHuman}
                        {b.status === 'error' && '!'}
                      </strong>
                      <code>{shortAddr(b.address)}</code>
                      {b.status === 'ok' && (
                        <small>
                          tx {b.txCount ?? 0}
                          {b.receivedAtomic && BigInt(b.receivedAtomic) > 0n ? ' · recv' : ''}
                        </small>
                      )}
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
