import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/x/btc': {
        target: 'https://mempool.space',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/btc/, '/api'),
      },
      '/x/btc2': {
        target: 'https://blockstream.info',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/btc2/, '/api'),
      },
      '/x/ltc': {
        target: 'https://litecoinspace.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/ltc/, '/api'),
      },
      '/x/blockcypher': {
        target: 'https://api.blockcypher.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/blockcypher/, '/v1'),
      },
      '/x/blockchair': {
        target: 'https://api.blockchair.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/blockchair/, ''),
      },
      '/x/dashinsight': {
        target: 'https://insight.dash.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/dashinsight/, '/insight-api'),
      },
      '/x/zec': {
        target: 'https://api.mainnet.cipherscan.app',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/zec/, ''),
      },
      '/x/tron': {
        target: 'https://api.trongrid.io',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/x\/tron/, ''),
      },
      '/x/rpc/eth': { target: 'https://ethereum.publicnode.com', changeOrigin: true, rewrite: () => '/' },
      '/x/rpc/bsc': { target: 'https://bsc-dataseed.binance.org', changeOrigin: true, rewrite: () => '/' },
      '/x/rpc/polygon': { target: 'https://polygon-bor.publicnode.com', changeOrigin: true, rewrite: () => '/' },
      '/x/rpc/arb': { target: 'https://arbitrum-one.publicnode.com', changeOrigin: true, rewrite: () => '/' },
      '/x/rpc/op': { target: 'https://optimism.publicnode.com', changeOrigin: true, rewrite: () => '/' },
      '/x/rpc/base': { target: 'https://base.publicnode.com', changeOrigin: true, rewrite: () => '/' },
      '/x/rpc/avax': {
        target: 'https://avalanche-c-chain-rpc.publicnode.com',
        changeOrigin: true,
        rewrite: () => '/',
      },
    },
  },
})
