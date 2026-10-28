/**
 * Low-level Web Crypto helpers. Framework-agnostic, no Angular deps.
 *
 * Wire params MUST match the server (api/services/crypto.service.js) byte-for-byte:
 *   RSA : 2048-bit, OAEP, MGF1 + SHA-256
 *   AES : AES-256-GCM, 96-bit (12-byte) random IV, 128-bit (16-byte) tag
 *   b64 : standard base64 for all binary on the wire
 *   body: JSON.stringify -> UTF-8 bytes
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Strip PEM armor + whitespace, return the DER (SPKI) bytes. */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return base64ToBytes(body);
}

export async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    'spki',
    der.buffer as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

/**
 * Generate a fresh AES-256-GCM key, RSA-wrap its raw bytes for transport, and
 * return the wrapped key (base64) plus a NON-EXTRACTABLE CryptoKey for use.
 * The raw key material is discarded immediately after wrapping.
 */
export async function generateWrappedAesKey(
  rsaPublicKey: CryptoKey,
): Promise<{ wrappedKeyB64: string; key: CryptoKey }> {
  const tmp = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const raw = await crypto.subtle.exportKey('raw', tmp);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaPublicKey, raw);
  // re-import as non-extractable so the key can never be read back out of memory
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  return { wrappedKeyB64: bufToBase64(wrapped), key };
}

export interface Envelope {
  data: string; // base64 ciphertext (WITHOUT the GCM tag)
  iv: string; // base64 12-byte IV
  tag: string; // base64 16-byte GCM tag
}

/** AES-GCM encrypt a JS value into the { data, iv, tag } wire parts. */
export async function encryptValue(key: CryptoKey, value: unknown): Promise<Envelope> {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 }, key, plaintext),
  );
  // WebCrypto appends the tag to the ciphertext; the server keeps them separate.
  const ct = sealed.slice(0, sealed.length - TAG_BYTES);
  const tag = sealed.slice(sealed.length - TAG_BYTES);
  return { data: bufToBase64(ct), iv: bufToBase64(iv), tag: bufToBase64(tag) };
}

/** AES-GCM decrypt the { data, iv, tag } wire parts back into a JS value. */
export async function decryptValue<T = unknown>(key: CryptoKey, env: Envelope): Promise<T> {
  const ct = base64ToBytes(env.data);
  const tag = base64ToBytes(env.tag);
  const iv = base64ToBytes(env.iv);
  const sealed = new Uint8Array(ct.length + tag.length);
  sealed.set(ct, 0);
  sealed.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
    key,
    sealed,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
