import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import * as secp from '@noble/secp256k1';
import { bech32 } from '@scure/base';
import bs58check from 'bs58check';
import type { NetworkId } from './types';

secp.hashes.sha256 = sha256;

const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

function hexToBytes(hex: string): Uint8Array {
  const h = hex.length % 2 ? `0${hex}` : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function base58Versioned(version: number | number[], payload: Uint8Array): string {
  const ver = Array.isArray(version) ? version : [version];
  const buf = new Uint8Array(ver.length + payload.length);
  buf.set(ver, 0);
  buf.set(payload, ver.length);
  return bs58check.encode(buf);
}

function p2wpkh(hrp: string, h160: Uint8Array): string {
  const words = bech32.toWords(h160);
  return bech32.encode(hrp, [0, ...words]);
}

export function wifToHex(wif: string): string {
  const decoded = bs58check.decode(wif);
  if (decoded.length !== 33 && decoded.length !== 34) {
    throw new Error('bad WIF');
  }
  return bytesToHex(decoded.slice(1, 33));
}

/** Classic brainwallet: SHA256(UTF-8 passphrase) → secp256k1 private key. */
export function brainwalletToHex(passphrase: string): string {
  if (!passphrase) throw new Error('empty passphrase');
  const hash = sha256(new TextEncoder().encode(passphrase));
  return normalizePrivHex(bytesToHex(hash));
}

export function normalizePrivHex(hex: string): string {
  const clean = hex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('bad hex key');
  const n = BigInt(`0x${clean}`);
  if (n === 0n || n >= N) throw new Error('key out of range');
  return clean;
}

export function deriveAddresses(privHex: string): Partial<Record<NetworkId, string>> {
  const key = normalizePrivHex(privHex);
  const keyBytes = hexToBytes(key);
  const pubCompressed = secp.getPublicKey(keyBytes, true);
  const pubUncompressed = secp.getPublicKey(keyBytes, false);
  const h160 = hash160(pubCompressed);

  const ethHash = keccak_256(pubUncompressed.slice(1));
  const eth20 = ethHash.slice(-20);
  const ethAddr = `0x${bytesToHex(eth20)}`;

  // Tron: 0x41 + eth20, base58check
  const tronPayload = new Uint8Array(21);
  tronPayload[0] = 0x41;
  tronPayload.set(eth20, 1);
  const tron = bs58check.encode(tronPayload);

  return {
    btc: base58Versioned(0x00, h160),
    btc_segwit: p2wpkh('bc', h160),
    ltc: base58Versioned(0x30, h160),
    doge: base58Versioned(0x1e, h160),
    dash: base58Versioned(0x4c, h160),
    zec: base58Versioned([0x1c, 0xb8], h160),
    eth: ethAddr,
    bsc: ethAddr,
    polygon: ethAddr,
    arb: ethAddr,
    op: ethAddr,
    base: ethAddr,
    avax: ethAddr,
    tron,
  };
}

export function detectAddressNetwork(address: string): NetworkId | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return 'eth';
  if (address.startsWith('bc1')) return 'btc_segwit';
  if (address.startsWith('t1') || address.startsWith('t3')) return 'zec';
  if (address.startsWith('T') && address.length === 34) return 'tron';
  if (address.startsWith('L') || address.startsWith('M') || address.startsWith('ltc1')) return 'ltc';
  if (address.startsWith('X')) return 'dash';
  if (address.startsWith('D') || address.startsWith('A') || address.startsWith('9')) return 'doge';
  if (address.startsWith('1') || address.startsWith('3')) return 'btc';
  return null;
}

export { hexToBytes, bytesToHex };
