export type NetworkId =
  | 'btc'
  | 'btc_segwit'
  | 'ltc'
  | 'doge'
  | 'dash'
  | 'zec'
  | 'eth'
  | 'bsc'
  | 'polygon'
  | 'arb'
  | 'op'
  | 'base'
  | 'avax'
  | 'tron';

export type InputKind = 'privkey_hex' | 'wif' | 'address' | 'brainwallet' | 'invalid';

export type BalanceStatus = 'idle' | 'loading' | 'ok' | 'error' | 'skipped';

export interface NetworkBalance {
  network: NetworkId;
  address: string;
  status: BalanceStatus;
  balanceAtomic: string;
  balanceHuman: string;
  receivedAtomic?: string;
  txCount?: number;
  error?: string;
  explorerUrl: string;
}

export interface DerivedWallet {
  id: string;
  rawLine: string;
  kind: InputKind;
  privateKeyHex?: string;
  addresses: Partial<Record<NetworkId, string>>;
  balances: NetworkBalance[];
  hasAnyFunds: boolean;
  isAlive: boolean;
  totalHits: number;
}

export const NETWORK_META: Record<
  NetworkId,
  { label: string; short: string; decimals: number; symbol: string; family: 'utxo' | 'evm' | 'tron' }
> = {
  btc: { label: 'Bitcoin', short: 'BTC', decimals: 8, symbol: 'BTC', family: 'utxo' },
  btc_segwit: { label: 'Bitcoin SegWit', short: 'BTC·bc1', decimals: 8, symbol: 'BTC', family: 'utxo' },
  ltc: { label: 'Litecoin', short: 'LTC', decimals: 8, symbol: 'LTC', family: 'utxo' },
  doge: { label: 'Dogecoin', short: 'DOGE', decimals: 8, symbol: 'DOGE', family: 'utxo' },
  dash: { label: 'Dash', short: 'DASH', decimals: 8, symbol: 'DASH', family: 'utxo' },
  zec: { label: 'Zcash', short: 'ZEC', decimals: 8, symbol: 'ZEC', family: 'utxo' },
  eth: { label: 'Ethereum', short: 'ETH', decimals: 18, symbol: 'ETH', family: 'evm' },
  bsc: { label: 'BNB Chain', short: 'BSC', decimals: 18, symbol: 'BNB', family: 'evm' },
  polygon: { label: 'Polygon', short: 'POL', decimals: 18, symbol: 'POL', family: 'evm' },
  arb: { label: 'Arbitrum', short: 'ARB', decimals: 18, symbol: 'ETH', family: 'evm' },
  op: { label: 'Optimism', short: 'OP', decimals: 18, symbol: 'ETH', family: 'evm' },
  base: { label: 'Base', short: 'BASE', decimals: 18, symbol: 'ETH', family: 'evm' },
  avax: { label: 'Avalanche', short: 'AVAX', decimals: 18, symbol: 'AVAX', family: 'evm' },
  tron: { label: 'Tron', short: 'TRX', decimals: 6, symbol: 'TRX', family: 'tron' },
};

export const DEFAULT_NETWORKS: NetworkId[] = [
  'btc',
  'btc_segwit',
  'eth',
  'bsc',
  'polygon',
  'arb',
  'op',
  'base',
  'avax',
  'tron',
  'ltc',
  'doge',
  'dash',
  'zec',
];
