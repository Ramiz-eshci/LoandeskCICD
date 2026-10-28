import { base64ToBytes, bufToBase64, decryptValue, encryptValue, pemToDer } from './crypto.util';

// Web Crypto subtle is present in Node's webcrypto but may be absent under jsdom;
// gate the handshake/round-trip tests on it so the pure helpers always run.
const subtle = (globalThis.crypto && globalThis.crypto.subtle) || undefined;
const itSubtle = subtle ? it : it.skip;

describe('crypto.util / base64 helpers', () => {
  it('round-trips bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const b64 = bufToBase64(bytes);
    expect(typeof b64).toBe('string');
    expect(Array.from(base64ToBytes(b64))).toEqual([0, 1, 2, 250, 255]);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const buf = new Uint8Array([65, 66, 67]).buffer;
    expect(base64ToBytes(bufToBase64(buf))).toEqual(new Uint8Array([65, 66, 67]));
  });
});

describe('crypto.util / pemToDer', () => {
  it('strips the PEM armor and whitespace, decoding the body', () => {
    const body = bufToBase64(new Uint8Array([1, 2, 3, 4]));
    const pem = `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
    expect(Array.from(pemToDer(pem))).toEqual([1, 2, 3, 4]);
  });
});

describe('crypto.util / AES-GCM round trip', () => {
  itSubtle('encrypts then decrypts a value back to equality', async () => {
    const key = await subtle!.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const value = { a: 1, b: 'two', c: [3, 4] };
    const env = await encryptValue(key, value);
    expect(typeof env.data).toBe('string');
    expect(typeof env.iv).toBe('string');
    expect(typeof env.tag).toBe('string');
    expect(await decryptValue(key, env)).toEqual(value);
  });
});
