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

/** Thrown when a provider signals a rate/usage limit (HTTP 402/429/503). */
class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Per-host limiter. Spaces out request *starts* by a minimum interval so we
 * don't hammer a single API, and honours a cooldown window set on 429/402.
 */
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  mempool: 250,
  blockstream: 250,
  litecoinspace: 250,
  blockcypher: 400,
  blockchair: 1100,
  'dash-insight': 500,
  zec: 300,
  tron: 300,
};

type HostState = { chain: Promise<void>; last: number; cooldownUntil: number };
const hostStates = new Map<string, HostState>();

function hostGate(host: string): Promise<void> {
  const min = HOST_MIN_INTERVAL_MS[host] ?? 250;
  const st = hostStates.get(host) ?? { chain: Promise.resolve(), last: 0, cooldownUntil: 0 };
  hostStates.set(host, st);
  const run = st.chain.then(async () => {
    const waitUntil = Math.max(st.last + min, st.cooldownUntil);
    const wait = waitUntil - Date.now();
    if (wait > 0) await sleep(wait);
    st.last = Date.now();
  });
  st.chain = run.catch(() => {});
  return run;
}

function bumpCooldown(host: string, ms: number) {
  const st = hostStates.get(host);
  if (st) st.cooldownUntil = Math.max(st.cooldownUntil, Date.now() + ms);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

async function fetchJson<T>(
  host: string,
  url: string,
  init?: RequestInit,
  retries = 4
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    await hostGate(host);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', ...(init?.headers || {}) },
      });
      if (res.status === 402 || res.status === 429 || res.status === 503 || res.status >= 500) {
        const backoff =
          parseRetryAfter(res.headers.get('Retry-After')) ?? Math.min(8000, 500 * 2 ** i);
        bumpCooldown(host, backoff);
        lastErr = new RateLimitError(`HTTP ${res.status} @ ${host}`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof RateLimitError) continue;
      await sleep(300 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type BalancePart = Pick<
  NetworkBalance,
  'balanceAtomic' | 'balanceHuman' | 'txCount' | 'receivedAtomic'
>;

function makePart(
  network: NetworkId,
  bal: bigint,
  received: bigint | null,
  txCount: number | undefined
): BalancePart {
  const meta = NETWORK_META[network];
  return {
    balanceAtomic: bal.toString(),
    receivedAtomic: received != null ? received.toString() : undefined,
    balanceHuman: `${formatAtomic(bal, meta.decimals)} ${meta.symbol}`,
    txCount,
  };
}

type Provider = { host: string; run: (address: string) => Promise<BalancePart> };

/** Try providers in order; fall through on rate-limit/errors to the next one. */
async function tryProviders(providers: Provider[], address: string): Promise<BalancePart> {
  let lastErr: unknown;
  let rateLimited = false;
  for (const p of providers) {
    try {
      return await p.run(address);
    } catch (e) {
      lastErr = e;
      if (e instanceof RateLimitError) rateLimited = true;
    }
  }
  if (rateLimited) {
    throw new RateLimitError('all providers rate-limited');
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type EsploraStats = {
  chain_stats?: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats?: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
};

/** Esplora-compatible API (mempool.space, blockstream.info, litecoinspace). */
function esploraProvider(host: string, base: string, network: NetworkId): Provider {
  return {
    host,
    run: async (address) => {
      const data = await fetchJson<EsploraStats>(
        host,
        `${base}/address/${encodeURIComponent(address)}`
      );
      const chain = data.chain_stats ?? { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 };
      const mem = data.mempool_stats ?? { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 };
      const bal =
        BigInt(chain.funded_txo_sum - chain.spent_txo_sum) +
        BigInt(mem.funded_txo_sum - mem.spent_txo_sum);
      const received = BigInt(chain.funded_txo_sum) + BigInt(mem.funded_txo_sum);
      return makePart(network, bal, received, chain.tx_count + mem.tx_count);
    },
  };
}

/** BlockCypher: /v1/{coin}/main/addrs/{addr}/balance (values already in atomic). */
function blockcypherProvider(base: string, coin: 'btc' | 'ltc' | 'doge', network: NetworkId): Provider {
  return {
    host: 'blockcypher',
    run: async (address) => {
      type Resp = { balance?: number; total_received?: number; final_n_tx?: number; n_tx?: number };
      const data = await fetchJson<Resp>(
        'blockcypher',
        `${base}/${coin}/main/addrs/${encodeURIComponent(address)}/balance`
      );
      const bal = BigInt(data.balance ?? 0);
      const received = BigInt(data.total_received ?? 0);
      return makePart(network, bal, received, data.final_n_tx ?? data.n_tx);
    },
  };
}

/** Blockchair dashboards API (DOGE/DASH). */
function blockchairProvider(chain: 'dogecoin' | 'dash', network: 'doge' | 'dash'): Provider {
  return {
    host: 'blockchair',
    run: async (address) => {
      type Resp = {
        data?: Record<
          string,
          { address?: { balance?: number; received?: number; transaction_count?: number } }
        >;
      };
      const data = await fetchJson<Resp>(
        'blockchair',
        proxyOr(
          `https://api.blockchair.com/${chain}/dashboards/address/${address}?limit=0`,
          `/x/blockchair/${chain}/dashboards/address/${address}?limit=0`
        )
      );
      const entry = data.data?.[address]?.address;
      return makePart(
        network,
        BigInt(entry?.balance ?? 0),
        BigInt(entry?.received ?? 0),
        entry?.transaction_count
      );
    },
  };
}

/** Dash Insight API fallback. */
function dashInsightProvider(): Provider {
  return {
    host: 'dash-insight',
    run: async (address) => {
      type Resp = { balanceSat?: number; totalReceivedSat?: number; txApperances?: number };
      const data = await fetchJson<Resp>(
        'dash-insight',
        proxyOr(
          `https://insight.dash.org/insight-api/addr/${encodeURIComponent(address)}`,
          `/x/dashinsight/addr/${encodeURIComponent(address)}`
        )
      );
      return makePart(
        'dash',
        BigInt(data.balanceSat ?? 0),
        BigInt(data.totalReceivedSat ?? 0),
        data.txApperances
      );
    },
  };
}

function btcProviders(network: NetworkId): Provider[] {
  return [
    esploraProvider('mempool', proxyOr('https://mempool.space/api', '/x/btc'), network),
    esploraProvider('blockstream', proxyOr('https://blockstream.info/api', '/x/btc2'), network),
    blockcypherProvider(proxyOr('https://api.blockcypher.com/v1', '/x/blockcypher'), 'btc', network),
  ];
}

function ltcProviders(): Provider[] {
  return [
    esploraProvider('litecoinspace', proxyOr('https://litecoinspace.org/api', '/x/ltc'), 'ltc'),
    blockcypherProvider(proxyOr('https://api.blockcypher.com/v1', '/x/blockcypher'), 'ltc', 'ltc'),
  ];
}

function dogeProviders(): Provider[] {
  return [
    blockchairProvider('dogecoin', 'doge'),
    blockcypherProvider(proxyOr('https://api.blockcypher.com/v1', '/x/blockcypher'), 'doge', 'doge'),
  ];
}

function dashProviders(): Provider[] {
  return [blockchairProvider('dash', 'dash'), dashInsightProvider()];
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

async function checkZec(address: string): Promise<BalancePart> {
  const url = proxyOr(
    `https://api.mainnet.cipherscan.app/api/address/${address}?page=1&limit=1`,
    `/x/zec/api/address/${address}?page=1&limit=1`
  );
  type Resp = { balance?: number; totalReceived?: number; txCount?: number; error?: string };
  const data = await fetchJson<Resp>('zec', url);
  if (data.error) throw new Error(data.error);
  return makePart(
    'zec',
    BigInt(data.balance ?? 0),
    data.totalReceived != null ? BigInt(data.totalReceived) : null,
    data.txCount
  );
}

async function checkTron(address: string): Promise<BalancePart> {
  const url = proxyOr(
    'https://api.trongrid.io/wallet/getaccount',
    '/x/tron/wallet/getaccount'
  );
  const data = await fetchJson<{ balance?: number; address?: string; create_time?: number }>(
    'tron',
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, visible: true }),
    }
  );
  const bal = BigInt(data.balance ?? 0);
  const alive = Boolean(data.create_time) || bal > 0n;
  return makePart('tron', bal, null, alive ? 1 : 0);
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
    let part: BalancePart;
    if (
      network === 'btc' ||
      network === 'btc_uncompressed' ||
      network === 'btc_script' ||
      network === 'btc_segwit'
    ) {
      part = await tryProviders(btcProviders(network), address);
    } else if (network === 'ltc') {
      part = await tryProviders(ltcProviders(), address);
    } else if (network === 'doge') {
      part = await tryProviders(dogeProviders(), address);
    } else if (network === 'dash') {
      part = await tryProviders(dashProviders(), address);
    } else if (network === 'zec') {
      part = await checkZec(address);
    } else if (network === 'tron') {
      part = await checkTron(address);
    } else {
      part = await checkEvm(network, address);
    }

    return { ...base, ...part, status: 'ok' };
  } catch (e) {
    if (e instanceof RateLimitError) {
      return {
        ...base,
        status: 'skipped',
        error: 'rate limit — повторите позже',
      };
    }
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
