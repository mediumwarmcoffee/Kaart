// Gedeelde kern voor de browser en voor Node (tools/kaart.mjs):
// sleutelafleiding, versleuteling en het bundelformaat.
//
// Sleutel = HKDF( geheim uit de link  ||  PBKDF2(wachtwoord) )
//   - het geheim (256 bits, willekeurig) staat achter de # in de link en wordt
//     door de browser nooit naar een server gestuurd;
//   - het wachtwoord wordt opgerekt met PBKDF2-HMAC-SHA256.
// Inhoud = AES-256-GCM over de hele bundel, met de kop als extra beveiligde data.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const FORMAT = 'KV01';
export const DEFAULT_ITERATIONS = 600000;

const HEADER_LENGTH = 36; // 4 formaat + 4 iteraties + 16 salt + 12 nonce
const TAG_LENGTH = 16;
const INFO = enc.encode('kaart/v1 aes-256-gcm');

export class VaultError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'VaultError';
    this.code = code;
  }
}

// Maakt het wachtwoord vergevingsgezind: hoofdletters, spaties, streepjes,
// accenten en leestekens tellen niet mee. Wat overblijft zijn letters en cijfers.
export function normalizePassword(input) {
  const raw = String(input ?? '');
  const folded = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return folded || raw.normalize('NFKC').trim();
}

export function fromBase64Url(text) {
  const clean = String(text).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) throw new VaultError('format', 'ongeldige sleutel');
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deriveKey(subtle, secret, password, salt, iterations, usage) {
  const material = await subtle.importKey(
    'raw', enc.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  const stretched = new Uint8Array(await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256));

  const ikm = new Uint8Array(secret.length + stretched.length);
  ikm.set(secret, 0);
  ikm.set(stretched, secret.length);

  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
    base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

// cryptoImpl is het Web Crypto-object: `crypto` in de browser en in Node.
export async function seal(cryptoImpl, plaintext, secret, password, iterations = DEFAULT_ITERATIONS) {
  const header = new Uint8Array(HEADER_LENGTH);
  header.set(enc.encode(FORMAT), 0);
  new DataView(header.buffer).setUint32(4, iterations);
  cryptoImpl.getRandomValues(header.subarray(8, 24));
  cryptoImpl.getRandomValues(header.subarray(24, 36));

  const key = await deriveKey(cryptoImpl.subtle, secret, password, header.slice(8, 24), iterations, 'encrypt');
  const body = new Uint8Array(await cryptoImpl.subtle.encrypt(
    { name: 'AES-GCM', iv: header.slice(24, 36), additionalData: header, tagLength: TAG_LENGTH * 8 },
    key, plaintext));

  const out = new Uint8Array(HEADER_LENGTH + body.length);
  out.set(header, 0);
  out.set(body, HEADER_LENGTH);
  return out;
}

export async function open(cryptoImpl, file, secret, password) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  if (bytes.length < HEADER_LENGTH + TAG_LENGTH || dec.decode(bytes.subarray(0, 4)) !== FORMAT) {
    throw new VaultError('format', 'onbekend bestandsformaat');
  }
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  if (iterations < 100000 || iterations > 20000000) throw new VaultError('format', 'ongeldige kop');

  const header = bytes.slice(0, HEADER_LENGTH);
  const key = await deriveKey(cryptoImpl.subtle, secret, password, bytes.slice(8, 24), iterations, 'decrypt');
  try {
    return new Uint8Array(await cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(24, 36), additionalData: header, tagLength: TAG_LENGTH * 8 },
      key, bytes.subarray(HEADER_LENGTH)));
  } catch {
    // Verkeerde sleutel, verkeerd wachtwoord of een gewijzigd bestand: niet te onderscheiden.
    throw new VaultError('key', 'ontsleutelen mislukt');
  }
}

// Bundel: [uint32 lengte van de index][index als JSON][alle bestanden achter elkaar]
export function pack(files, meta = {}) {
  let offset = 0;
  const index = files.map((f) => {
    const entry = { path: f.path, type: f.type, offset, length: f.data.length };
    offset += f.data.length;
    return entry;
  });
  const manifest = enc.encode(JSON.stringify({ v: 1, ...meta, files: index }));
  const out = new Uint8Array(4 + manifest.length + offset);
  new DataView(out.buffer).setUint32(0, manifest.length);
  out.set(manifest, 4);
  let at = 4 + manifest.length;
  for (const f of files) {
    out.set(f.data, at);
    at += f.data.length;
  }
  return out;
}

export function unpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const manifestLength = view.getUint32(0);
  const manifest = JSON.parse(dec.decode(bytes.subarray(4, 4 + manifestLength)));
  const base = 4 + manifestLength;
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  return {
    manifest,
    has: (path) => byPath.has(path),
    bytes(path) {
      const f = byPath.get(path);
      if (!f) throw new VaultError('missing', `ontbreekt in bundel: ${path}`);
      return bytes.subarray(base + f.offset, base + f.offset + f.length);
    },
    text(path) {
      return dec.decode(this.bytes(path));
    },
  };
}
