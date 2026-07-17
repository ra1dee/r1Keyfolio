import { classifyLine, parseInputLines } from './parse';
import { deriveAddresses, detectAddressNetwork, wifToHex } from './derive';
import { checkBalance, mapPool } from './balances';
import type { DerivedWallet, NetworkId } from './types';
import { DEFAULT_NETWORKS } from './types';

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

const EVM_NETS: NetworkId[] = ['eth', 'bsc', 'polygon', 'arb', 'op', 'base', 'avax'];

export function buildWalletsFromText(
  text: string,
  networks: NetworkId[] = DEFAULT_NETWORKS
): DerivedWallet[] {
  return parseInputLines(text).map((rawLine) => {
    const { kind } = classifyLine(rawLine);
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
      if (kind === 'privkey_hex') {
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
        explorerUrl: '#',
      }));

    return wallet;
  });
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
  }
): Promise<DerivedWallet[]> {
  const concurrency = opts.concurrency ?? 6;
  const jobs: { wi: number; bi: number }[] = [];
  wallets.forEach((w, wi) => w.balances.forEach((_, bi) => jobs.push({ wi, bi })));

  const next: DerivedWallet[] = wallets.map((w) => ({
    ...w,
    balances: w.balances.map((b) => ({ ...b, status: 'loading' as const })),
  }));
  opts.onUpdate(next.map((x) => ({ ...x, balances: [...x.balances] })));

  let done = 0;
  await mapPool(jobs, concurrency, async ({ wi, bi }) => {
    const row = next[wi]!.balances[bi]!;
    next[wi]!.balances[bi] = await checkBalance(row.network, row.address);
    summarize(next[wi]!);
    done += 1;
    opts.onProgress?.(done, jobs.length);
    opts.onUpdate(next.map((x) => ({ ...x, balances: [...x.balances] })));
    return next[wi]!.balances[bi]!;
  });

  return next;
}
