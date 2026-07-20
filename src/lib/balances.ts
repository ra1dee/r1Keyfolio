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
  eth: { direct: 'https://ethereum.publicnode.com', proxy: '/x/rpc/eth' },
  bsc: { direct: 'https://bsc-dataseed.binance.org', proxy: '/x/rpc/bsc' },
  polygon: { direct: 'https://polygon-bor.publicnode.com', proxy: '/x/rpc/polygon' },
  arb: { direct: 'https://arbitrum-one.publicnode.com', proxy: '/x/rpc/arb' },
  op: { direct: 'https://optimism.publicnode.com', proxy: '/x/rpc/op' },
  base: { direct: 'https://base.publicnode.com', proxy: '/x/rpc/base' },
  avax: {
    direct: 'https://avalanche-c-chain-rpc.publicnode.com',
    proxy: '/x/rpc/avax',
  },
};

/** Blockchair chain slug for UTXO networks. */
export const BLOCKCHAIR_CHAIN: Partial<Record<NetworkId, string>> = {
  btc: 'bitcoin',
  btc_uncompressed: 'bitcoin',
  btc_script: 'bitcoin',
  btc_segwit: 'bitcoin',
  ltc: 'litecoin',
  doge: 'dogecoin',
  dash: 'dash',
  zec: 'zcash',
};

export function isBlockchairNetwork(network: NetworkId): boolean {
  return network in BLOCKCHAIR_CHAIN;
}

export function explorer(network: NetworkId, address: string): string {
  switch (network) {
    case 'btc':
    case 'btc_uncompressed':
    case 'btc_script':
    case 'btc_segwit':
      return `https://blockchair.com/bitcoin/address/${address}`;
    case 'ltc':
      return `https://blockchair.com/litecoin/address/${address}`;
    case 'doge':
      return `https://blockchair.com/dogecoin/address/${address}`;
    case 'dash':
      return `https://blockchair.com/dash/address/${address}`;
    case 'zec':
      return `https://blockchair.com/zcash/address/${address}`;
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

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// ——— Blockchair usage / limits ———
// Free: ~1440 request points / day, hard 30 req/min, soft ~5/sec under load.
// Daily counter resets at 00:00 UTC.
export const BLOCKCHAIR_DAILY_LIMIT = 1440;
/** Stay under 30/min: ~1 request every 2.1s. */
const BLOCKCHAIR_MIN_INTERVAL_MS = 2100;
const KEY_STORAGE = 'keyfolio_blockchair_key';
const USAGE_STORAGE = 'keyfolio_blockchair_usage';

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function nextUtcMidnightMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export type BlockchairUsage = {
  dayUtc: string;
  cost: number;
  requests: number;
};

export function getBlockchairApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setBlockchairApiKey(key: string) {
  try {
    const v = key.trim();
    if (v) localStorage.setItem(KEY_STORAGE, v);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function getBlockchairUsage(): BlockchairUsage {
  const day = utcDayKey();
  try {
    const raw = localStorage.getItem(USAGE_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as BlockchairUsage;
      if (parsed.dayUtc === day) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { dayUtc: day, cost: 0, requests: 0 };
}

function saveUsage(u: BlockchairUsage) {
  try {
    localStorage.setItem(USAGE_STORAGE, JSON.stringify(u));
  } catch {
    /* ignore */
  }
}

function recordUsage(cost: number) {
  const u = getBlockchairUsage();
  u.cost += cost;
  u.requests += 1;
  saveUsage(u);
  return u;
}

export function blockchairResetInMs(now = Date.now()): number {
  return Math.max(0, nextUtcMidnightMs(now) - now);
}

export function formatResetCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

type HostState = { chain: Promise<void>; last: number; cooldownUntil: number };
const blockchairGateState: HostState = {
  chain: Promise.resolve(),
  last: 0,
  cooldownUntil: 0,
};

function gateBlockchair(): Promise<void> {
  const run = blockchairGateState.chain.then(async () => {
    const waitUntil = Math.max(
      blockchairGateState.last + BLOCKCHAIR_MIN_INTERVAL_MS,
      blockchairGateState.cooldownUntil
    );
    const wait = waitUntil - Date.now();
    if (wait > 0) await sleep(wait);
    blockchairGateState.last = Date.now();
  });
  blockchairGateState.chain = run.catch(() => {});
  return run;
}

function bumpBlockchairCooldown(ms: number) {
  blockchairGateState.cooldownUntil = Math.max(
    blockchairGateState.cooldownUntil,
    Date.now() + ms
  );
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
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

/**
 * Mass balance check via Blockchair.
 * Cost ≈ 1 + 0.001 * addresses. Zero/unseen addresses are omitted from `data`.
 * Docs: POST /{chain}/addresses/balances
 */
export async function fetchBlockchairBalances(
  chain: string,
  addresses: string[]
): Promise<Map<string, bigint>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const out = new Map<string, bigint>();
  if (!unique.length) return out;

  // Chunk conservatively (POST body can be large; 2k is plenty for our UI).
  const CHUNK = 2000;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const map = await fetchBlockchairBalancesChunk(chain, chunk);
    for (const [addr, bal] of map) out.set(addr, bal);
  }
  return out;
}

async function fetchBlockchairBalancesChunk(
  chain: string,
  addresses: string[]
): Promise<Map<string, bigint>> {
  const key = getBlockchairApiKey();
  const usage = getBlockchairUsage();
  if (!key && usage.cost >= BLOCKCHAIR_DAILY_LIMIT) {
    throw new RateLimitError(
      `Blockchair daily limit (~${BLOCKCHAIR_DAILY_LIMIT}) reached. Reset at 00:00 UTC.`
    );
  }

  const base = proxyOr('https://api.blockchair.com', '/x/blockchair');
  const qs = key ? `?key=${encodeURIComponent(key)}` : '';
  const url = `${base}/${chain}/addresses/balances${qs}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    await gateBlockchair();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `addresses=${encodeURIComponent(addresses.join(','))}`,
      });

      if (
        res.status === 402 ||
        res.status === 429 ||
        res.status === 430 ||
        res.status === 434 ||
        res.status === 435 ||
        res.status === 503 ||
        res.status >= 500
      ) {
        const backoff =
          parseRetryAfter(res.headers.get('Retry-After')) ??
          Math.min(15_000, 2000 * 2 ** attempt);
        bumpBlockchairCooldown(backoff);
        lastErr = new RateLimitError(`Blockchair HTTP ${res.status}`);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Blockchair HTTP ${res.status}: ${text.slice(0, 120)}`);
      }

      type Resp = {
        data?: Record<string, number>;
        context?: { request_cost?: number; code?: number; error?: string };
      };
      const json = (await res.json()) as Resp;
      if (json.context?.error) throw new Error(json.context.error);

      const cost = Number(json.context?.request_cost ?? 1 + 0.001 * addresses.length);
      recordUsage(Number.isFinite(cost) ? cost : 1);

      const map = new Map<string, bigint>();
      for (const [addr, bal] of Object.entries(json.data ?? {})) {
        map.set(addr, BigInt(bal));
      }
      // Addresses missing from `data` have zero confirmed balance (or never seen).
      for (const addr of addresses) {
        if (!map.has(addr)) map.set(addr, 0n);
      }
      return map;
    } catch (e) {
      lastErr = e;
      if (e instanceof RateLimitError) continue;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function balanceFromAtomic(
  network: NetworkId,
  address: string,
  bal: bigint,
  status: NetworkBalance['status'] = 'ok',
  error?: string,
  extras?: { received?: bigint | null; txCount?: number }
): NetworkBalance {
  const received = extras?.received ?? null;
  const txCount =
    extras?.txCount ?? (bal > 0n || (received != null && received > 0n) ? 1 : 0);
  const part = makePart(network, bal, received, txCount);
  return {
    network,
    address,
    status,
    explorerUrl: explorer(network, address),
    ...part,
    error,
  };
}

/** blockchain.info /balance — BTC only, multiple addresses via `|`. */
export type BciBalance = {
  balance: bigint;
  received: bigint;
  txCount: number;
};

const bciGateState: HostState = { chain: Promise.resolve(), last: 0, cooldownUntil: 0 };
/** Official guidance historically ~1 req / 10s; keep a safe gap. */
const BCI_MIN_INTERVAL_MS = 3500;

function gateBci(): Promise<void> {
  const run = bciGateState.chain.then(async () => {
    const waitUntil = Math.max(
      bciGateState.last + BCI_MIN_INTERVAL_MS,
      bciGateState.cooldownUntil
    );
    const wait = waitUntil - Date.now();
    if (wait > 0) await sleep(wait);
    bciGateState.last = Date.now();
  });
  bciGateState.chain = run.catch(() => {});
  return run;
}

function bumpBciCooldown(ms: number) {
  bciGateState.cooldownUntil = Math.max(bciGateState.cooldownUntil, Date.now() + ms);
}

/**
 * Batch BTC balances via blockchain.info.
 * GET /balance?active=addr1|addr2&cors=true
 * Returns final_balance, total_received, n_tx for every address (incl. zeros).
 */
export async function fetchBlockchainInfoBalances(
  addresses: string[]
): Promise<Map<string, BciBalance>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const out = new Map<string, BciBalance>();
  if (!unique.length) return out;

  // Keep URL reasonably short (pipe-joined).
  const CHUNK = 40;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const map = await fetchBlockchainInfoChunk(chunk);
    for (const [addr, row] of map) out.set(addr, row);
  }
  return out;
}

async function fetchBlockchainInfoChunk(
  addresses: string[]
): Promise<Map<string, BciBalance>> {
  const base = proxyOr('https://blockchain.info', '/x/bci');
  const active = addresses.map(encodeURIComponent).join('|');
  const url = `${base}/balance?active=${active}&cors=true`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    await gateBci();
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status === 429 || res.status === 402 || res.status >= 500) {
        const backoff =
          parseRetryAfter(res.headers.get('Retry-After')) ??
          Math.min(20_000, 4000 * 2 ** attempt);
        bumpBciCooldown(backoff);
        lastErr = new RateLimitError(`blockchain.info HTTP ${res.status}`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`blockchain.info HTTP ${res.status}: ${text.slice(0, 120)}`);
      }

      type Row = { final_balance?: number; total_received?: number; n_tx?: number };
      const json = (await res.json()) as Record<string, Row>;
      const map = new Map<string, BciBalance>();
      for (const addr of addresses) {
        const row = json[addr];
        map.set(addr, {
          balance: BigInt(row?.final_balance ?? 0),
          received: BigInt(row?.total_received ?? 0),
          txCount: row?.n_tx ?? 0,
        });
      }
      return map;
    } catch (e) {
      lastErr = e;
      if (e instanceof RateLimitError) continue;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
): Promise<BalancePart> {
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

async function checkTron(address: string): Promise<BalancePart> {
  const url = proxyOr(
    'https://api.trongrid.io/wallet/getaccount',
    '/x/tron/wallet/getaccount'
  );
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, visible: true }),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        balance?: number;
        create_time?: number;
      };
      const bal = BigInt(data.balance ?? 0);
      const alive = Boolean(data.create_time) || bal > 0n;
      return makePart('tron', bal, null, alive ? 1 : 0);
    } catch (e) {
      lastErr = e;
      await sleep(300 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Single-address check for non-Blockchair networks (EVM / Tron). */
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
    if (isBlockchairNetwork(network)) {
      const chain = BLOCKCHAIR_CHAIN[network]!;
      if (chain === 'bitcoin') {
        try {
          const bci = await fetchBlockchainInfoBalances([address]);
          const row = bci.get(address);
          return balanceFromAtomic(network, address, row?.balance ?? 0n, 'ok', undefined, {
            received: row?.received ?? 0n,
            txCount: row?.txCount ?? 0,
          });
        } catch {
          /* fall through to Blockchair */
        }
      }
      const map = await fetchBlockchairBalances(chain, [address]);
      const bal = map.get(address) ?? 0n;
      return balanceFromAtomic(network, address, bal);
    }

    let part: BalancePart;
    if (network === 'tron') {
      part = await checkTron(address);
    } else if (
      network === 'eth' ||
      network === 'bsc' ||
      network === 'polygon' ||
      network === 'arb' ||
      network === 'op' ||
      network === 'base' ||
      network === 'avax'
    ) {
      part = await checkEvm(network, address);
    } else {
      throw new Error(`unsupported network: ${network}`);
    }

    return { ...base, ...part, status: 'ok' };
  } catch (e) {
    if (e instanceof RateLimitError) {
      return {
        ...base,
        status: 'skipped',
        error: e.message,
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
