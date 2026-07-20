import { classifyLine, parseInputLines } from './parse';
import { brainwalletToHex, deriveAddresses, detectAddressNetwork, wifToHex } from './derive';
import {
  BLOCKCHAIR_CHAIN,
  balanceFromAtomic,
  checkBalance,
  explorer,
  fetchBlockchairBalances,
  fetchBlockchainInfoBalances,
  isBlockchairNetwork,
  mapPool,
  RateLimitError,
} from './balances';
import type { DerivedWallet, NetworkId } from './types';
import { DEFAULT_NETWORKS } from './types';

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

const EVM_NETS: NetworkId[] = ['eth', 'bsc', 'polygon', 'arb', 'op', 'base', 'avax'];

export type InputMode = 'normal' | 'brain' | 'both';

export function buildWalletsFromText(
  text: string,
  networks: NetworkId[] = DEFAULT_NETWORKS,
  opts?: { inputMode?: InputMode }
): DerivedWallet[] {
  const inputMode = opts?.inputMode ?? 'normal';
  const modes: Exclude<InputMode, 'both'>[] =
    inputMode === 'both' ? ['normal', 'brain'] : [inputMode];

  return parseInputLines(text).flatMap((rawLine) =>
    modes.map((mode) => {
      const kind = mode === 'brain' ? ('brainwallet' as const) : classifyLine(rawLine).kind;
      const wallet: DerivedWallet = {
        id: uid(),
        rawLine,
        kind,
        addresses: {},
        balances: [],
        hasAnyFunds: false,
        isAlive: false,
        totalHits: 0,
      };

      try {
        if (kind === 'brainwallet') {
          wallet.privateKeyHex = brainwalletToHex(rawLine);
          wallet.addresses = deriveAddresses(wallet.privateKeyHex);
        } else if (kind === 'privkey_hex') {
          wallet.privateKeyHex = rawLine.toLowerCase();
          wallet.addresses = deriveAddresses(wallet.privateKeyHex);
        } else if (kind === 'wif') {
          wallet.privateKeyHex = wifToHex(rawLine);
          wallet.addresses = deriveAddresses(wallet.privateKeyHex);
        } else if (kind === 'address') {
          const asEth = /^[0-9a-fA-F]{40}$/.test(rawLine)
            ? `0x${rawLine.toLowerCase()}`
            : rawLine;
          const net = detectAddressNetwork(asEth);
          if (net === 'eth' || /^0x[0-9a-fA-F]{40}$/.test(asEth)) {
            for (const n of EVM_NETS) wallet.addresses[n] = asEth;
          } else if (net) {
            wallet.addresses[net] = asEth;
          }
        }
      } catch {
        wallet.kind = 'invalid';
      }

      wallet.balances = networks
        .filter((n) => Boolean(wallet.addresses[n]))
        .map((n) => ({
          network: n,
          address: wallet.addresses[n]!,
          status: 'idle' as const,
          balanceAtomic: '0',
          balanceHuman: '—',
          explorerUrl: explorer(n, wallet.addresses[n]!),
        }));

      return wallet;
    })
  );
}

function summarize(w: DerivedWallet) {
  w.hasAnyFunds = w.balances.some(
    (b) => b.status === 'ok' && BigInt(b.balanceAtomic || '0') > 0n
  );
  w.isAlive = w.balances.some(
    (b) =>
      b.status === 'ok' &&
      ((b.txCount ?? 0) > 0 ||
        BigInt(b.balanceAtomic || '0') > 0n ||
        BigInt(b.receivedAtomic || '0') > 0n)
  );
  w.totalHits = w.balances.filter(
    (b) => b.status === 'ok' && BigInt(b.balanceAtomic || '0') > 0n
  ).length;
}

export async function scanBalances(
  wallets: DerivedWallet[],
  opts: {
    concurrency?: number;
    onUpdate: (wallets: DerivedWallet[]) => void;
    onProgress?: (done: number, total: number) => void;
    onUsage?: () => void;
  }
): Promise<DerivedWallet[]> {
  const concurrency = opts.concurrency ?? 4;

  const next: DerivedWallet[] = wallets.map((w) => ({
    ...w,
    balances: w.balances.map((b) => ({ ...b, status: 'loading' as const })),
  }));
  opts.onUpdate(next.map((x) => ({ ...x, balances: [...x.balances] })));

  // Count all balance cells for progress.
  let total = 0;
  for (const w of next) total += w.balances.length;
  let done = 0;
  const bump = (n = 1) => {
    done += n;
    opts.onProgress?.(done, total);
  };

  // ——— Blockchair UTXO: one mass request per chain ———
  const byChain = new Map<string, { wi: number; bi: number; address: string }[]>();
  for (let wi = 0; wi < next.length; wi++) {
    const w = next[wi]!;
    for (let bi = 0; bi < w.balances.length; bi++) {
      const row = w.balances[bi]!;
      if (!isBlockchairNetwork(row.network)) continue;
      const chain = BLOCKCHAIR_CHAIN[row.network]!;
      const list = byChain.get(chain) ?? [];
      list.push({ wi, bi, address: row.address });
      byChain.set(chain, list);
    }
  }

  for (const [chain, jobs] of byChain) {
    const addresses = jobs.map((j) => j.address);
    try {
      if (chain === 'bitcoin') {
        // Prefer blockchain.info for BTC (free multi-addr + n_tx/received),
        // fall back to Blockchair mass check.
        try {
          const bci = await fetchBlockchainInfoBalances(addresses);
          for (const job of jobs) {
            const row = bci.get(job.address);
            const net = next[job.wi]!.balances[job.bi]!.network;
            next[job.wi]!.balances[job.bi] = balanceFromAtomic(
              net,
              job.address,
              row?.balance ?? 0n,
              'ok',
              undefined,
              { received: row?.received ?? 0n, txCount: row?.txCount ?? 0 }
            );
            summarize(next[job.wi]!);
          }
        } catch (bciErr) {
          const balances = await fetchBlockchairBalances(chain, addresses);
          opts.onUsage?.();
          for (const job of jobs) {
            const bal = balances.get(job.address) ?? 0n;
            const net = next[job.wi]!.balances[job.bi]!.network;
            next[job.wi]!.balances[job.bi] = balanceFromAtomic(net, job.address, bal);
            summarize(next[job.wi]!);
          }
          if (bciErr instanceof RateLimitError) {
            /* used Blockchair fallback after BCI limit */
          }
        }
      } else {
        const balances = await fetchBlockchairBalances(chain, addresses);
        opts.onUsage?.();
        for (const job of jobs) {
          const bal = balances.get(job.address) ?? 0n;
          const net = next[job.wi]!.balances[job.bi]!.network;
          next[job.wi]!.balances[job.bi] = balanceFromAtomic(net, job.address, bal);
          summarize(next[job.wi]!);
        }
      }
    } catch (e) {
      const skipped = e instanceof RateLimitError;
      for (const job of jobs) {
        const net = next[job.wi]!.balances[job.bi]!.network;
        next[job.wi]!.balances[job.bi] = balanceFromAtomic(
          net,
          job.address,
          0n,
          skipped ? 'skipped' : 'error',
          e instanceof Error ? e.message : String(e)
        );
        summarize(next[job.wi]!);
      }
    }
    bump(jobs.length);
    opts.onUpdate(next.map((x) => ({ ...x, balances: [...x.balances] })));
  }

  // ——— EVM / Tron: per-address ———
  const otherJobs: { wi: number; bi: number }[] = [];
  for (let wi = 0; wi < next.length; wi++) {
    const w = next[wi]!;
    for (let bi = 0; bi < w.balances.length; bi++) {
      if (!isBlockchairNetwork(w.balances[bi]!.network)) {
        otherJobs.push({ wi, bi });
      }
    }
  }

  if (otherJobs.length) {
    await mapPool(otherJobs, concurrency, async ({ wi, bi }) => {
      const row = next[wi]!.balances[bi]!;
      next[wi]!.balances[bi] = await checkBalance(row.network, row.address);
      summarize(next[wi]!);
      bump(1);
      opts.onUpdate(next.map((x) => ({ ...x, balances: [...x.balances] })));
      return next[wi]!.balances[bi]!;
    });
  }

  return next;
}
