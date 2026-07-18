import { JsonRpcProvider, formatUnits } from 'ethers';
import type { NetworkBalance, NetworkId } from './types';
import { NETWORK_META } from './types';

/** Prefer nginx/Vite /x proxies when VITE_USE_PROXY=true, else auto in vite-dev. */
function proxyOr(direct: string, proxyPath: string): string {
  if (import.meta.env.VITE_USE_PROXY === 'true') return proxyPath;
  if (import.meta.env.DEV) return proxyPath;
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __KEYFOLIO_PROXY__?: boolean };
    if (w.__KEYFOLIO_PROXY__) return proxyPath;
  }
  return direct;
}

const EVM_RPC: Partial<Record<NetworkId, { direct: string; proxy: string }>> = {
  eth: {
    direct: 'https://ethereum.publicnode.com',
    proxy: '/x/rpc/eth',
  },
  bsc: {
    direct: 'https://bsc-dataseed.binance.org',
    proxy: '/x/rpc/bsc',
  },
  polygon: {
    direct: 'https://polygon-bor.publicnode.com',
    proxy: '/x/rpc/polygon',
  },
  arb: {
    direct: 'https://arbitrum-one.publicnode.com',
    proxy: '/x/rpc/arb',
  },
  op: {
    direct: 'https://optimism.publicnode.com',
    proxy: '/x/rpc/op',
  },
  base: {
    direct: 'https://base.publicnode.com',
    proxy: '/x/rpc/base',
  },
  avax: {
    direct: 'https://avalanche-c-chain-rpc.publicnode.com',
    proxy: '/x/rpc/avax',
  },
};

function explorer(network: NetworkId, address: string): string {
  switch (network) {
    case 'btc':
    case 'btc_uncompressed':
    case 'btc_script':
    case 'btc_segwit':
      return `https://mempool.space/address/${address}`;
    case 'ltc':
      return `https://litecoinspace.org/address/${address}`;
    case 'doge':
      return `https://blockchair.com/dogecoin/address/${address}`;
    case 'dash':
      return `https://blockchair.com/dash/address/${address}`;
    case 'zec':
      return `https://3xpl.com/zcash/address/${address}`;
    case 'eth':
      return `https://etherscan.io/address/${address}`;
    case 'bsc':
      return `https://bscscan.com/address/${address}`;
    case 'polygon':
      return `https://polygonscan.com/address/${address}`;
    case 'arb':
      return `https://arbiscan.io/address/${address}`;
    case 'op':
      return `https://optimistic.etherscan.io/address/${address}`;
    case 'base':
      return `https://basescan.org/address/${address}`;
    case 'avax':
      return `https://snowtrace.io/address/${address}`;
    case 'tron':
      return `https://tronscan.org/#/address/${address}`;
  }
}

export function formatAtomic(atomic: bigint, decimals: number): string {
  if (atomic === 0n) return '0';
  const neg = atomic < 0n;
  const v = neg ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = frac ? `${whole}.${frac}` : whole.toString();
  return neg ? `-${body}` : body;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson<T>(url: string, init?: RequestInit, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', ...(init?.headers || {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 * (i + 1));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      await sleep(300 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type UtxoStats = {
  chain_stats?: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats?: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
};

async function checkMempoolFamily(
  network: 'btc' | 'btc_uncompressed' | 'btc_script' | 'btc_segwit' | 'ltc',
  address: string
): Promise<Pick<NetworkBalance, 'balanceAtomic' | 'balanceHuman' | 'txCount' | 'receivedAtomic'>> {
  const base =
    network === 'ltc'
      ? proxyOr('https://litecoinspace.org/api', '/x/ltc')
      : proxyOr('https://mempool.space/api', '/x/btc');
  const data = await fetchJson<UtxoStats>(`${base}/address/${encodeURIComponent(address)}`);
  const chain = data.chain_stats ?? { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 };
  const mem = data.mempool_stats ?? { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 };
  const bal =
    BigInt(chain.funded_txo_sum - chain.spent_txo_sum) +
    BigInt(mem.funded_txo_sum - mem.spent_txo_sum);
  const received = BigInt(chain.funded_txo_sum) + BigInt(mem.funded_txo_sum);
  const meta = NETWORK_META[network];
  return {
    balanceAtomic: bal.toString(),
    receivedAtomic: received.toString(),
    balanceHuman: `${formatAtomic(bal, meta.decimals)} ${meta.symbol}`,
    txCount: chain.tx_count + mem.tx_count,
  };
}

async function checkBlockchair(
  chain: 'dogecoin' | 'dash',
  network: 'doge' | 'dash',
  address: string
): Promise<Pick<NetworkBalance, 'balanceAtomic' | 'balanceHuman' | 'txCount' | 'receivedAtomic'>> {
  const url = proxyOr(
    `https://api.blockchair.com/${chain}/dashboards/address/${address}?limit=0`,
    `/x/blockchair/${chain}/dashboards/address/${address}?limit=0`
  );
  type Resp = {
    data?: Record<
      string,
      {
        address?: {
          balance?: number;
          received?: number;
          transaction_count?: number;
        };
      }
    >;
  };
  const data = await fetchJson<Resp>(url);
  const entry = data.data?.[address]?.address;
  const bal = BigInt(entry?.balance ?? 0);
  const received = BigInt(entry?.received ?? 0);
  const meta = NETWORK_META[network];
  return {
    balanceAtomic: bal.toString(),
    receivedAtomic: received.toString(),
    balanceHuman: `${formatAtomic(bal, meta.decimals)} ${meta.symbol}`,
    txCount: entry?.transaction_count,
  };
}

async function checkEvm(
  network: Exclude<
    NetworkId,
    | 'btc'
    | 'btc_uncompressed'
    | 'btc_script'
    | 'btc_segwit'
    | 'ltc'
    | 'doge'
    | 'dash'
    | 'zec'
    | 'tron'
  >,
  address: string
): Promise<Pick<NetworkBalance, 'balanceAtomic' | 'balanceHuman' | 'txCount'>> {
  const conf = EVM_RPC[network];
  if (!conf) throw new Error('no rpc');
  const rpc = proxyOr(conf.direct, conf.proxy);
  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  let bal = 0n;
  let txCount = 0;
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      bal = await provider.getBalance(address);
      txCount = Number(await provider.getTransactionCount(address));
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(250 * (i + 1));
    }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  const meta = NETWORK_META[network];
  return {
    balanceAtomic: bal.toString(),
    balanceHuman: `${formatUnits(bal, meta.decimals)} ${meta.symbol}`,
    txCount,
  };
}

async function checkZec(
  address: string
): Promise<Pick<NetworkBalance, 'balanceAtomic' | 'balanceHuman' | 'txCount' | 'receivedAtomic'>> {
  const url = proxyOr(
    `https://api.mainnet.cipherscan.app/api/address/${address}?page=1&limit=1`,
    `/x/zec/api/address/${address}?page=1&limit=1`
  );
  type Resp = { balance?: number; totalReceived?: number; txCount?: number; error?: string };
  const data = await fetchJson<Resp>(url);
  if (data.error) throw new Error(data.error);
  const bal = BigInt(data.balance ?? 0);
  const meta = NETWORK_META.zec;
  return {
    balanceAtomic: bal.toString(),
    receivedAtomic: data.totalReceived != null ? String(data.totalReceived) : undefined,
    balanceHuman: `${formatAtomic(bal, meta.decimals)} ${meta.symbol}`,
    txCount: data.txCount,
  };
}

async function checkTron(
  address: string
): Promise<Pick<NetworkBalance, 'balanceAtomic' | 'balanceHuman' | 'txCount'>> {
  const url = proxyOr(
    'https://api.trongrid.io/wallet/getaccount',
    '/x/tron/wallet/getaccount'
  );
  const data = await fetchJson<{ balance?: number; address?: string; create_time?: number }>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, visible: true }),
    }
  );
  const bal = BigInt(data.balance ?? 0);
  const meta = NETWORK_META.tron;
  const alive = Boolean(data.create_time) || bal > 0n;
  return {
    balanceAtomic: bal.toString(),
    balanceHuman: `${formatAtomic(bal, meta.decimals)} ${meta.symbol}`,
    txCount: alive ? 1 : 0,
  };
}

export async function checkBalance(
  network: NetworkId,
  address: string
): Promise<NetworkBalance> {
  const base: NetworkBalance = {
    network,
    address,
    status: 'loading',
    balanceAtomic: '0',
    balanceHuman: '—',
    explorerUrl: explorer(network, address),
  };

  try {
    let part: Pick<
      NetworkBalance,
      'balanceAtomic' | 'balanceHuman' | 'txCount' | 'receivedAtomic'
    >;
    if (
      network === 'btc' ||
      network === 'btc_uncompressed' ||
      network === 'btc_script' ||
      network === 'btc_segwit' ||
      network === 'ltc'
    ) {
      part = await checkMempoolFamily(network, address);
    } else if (network === 'doge') {
      part = await checkBlockchair('dogecoin', 'doge', address);
    } else if (network === 'dash') {
      part = await checkBlockchair('dash', 'dash', address);
    } else if (network === 'zec') {
      part = await checkZec(address);
    } else if (network === 'tron') {
      part = await checkTron(address);
    } else {
      part = await checkEvm(network, address);
    }

    return { ...base, ...part, status: 'ok' };
  } catch (e) {
    return {
      ...base,
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker())
  );
  return results;
}
