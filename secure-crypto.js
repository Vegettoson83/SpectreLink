import { hexToUint8Array, uint8ArrayToHex, arrayBufferToBase64, base64ToArrayBuffer } from './_helpers.js';

export class SecureCrypto {
  constructor(keyHex) {
    if (keyHex && keyHex.length !== 64) {
      throw new Error('Master key must be 64 hex characters');
    }
    this.masterKey = keyHex ? hexToUint8Array(keyHex) : null;
  }

  async encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const algorithm = { name: 'AES-GCM', iv, tagLength: 128 };
    const cryptoKey = await crypto.subtle.importKey('raw', key, algorithm.name, false, ['encrypt']);
    const dataToEncrypt = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    const encrypted = await crypto.subtle.encrypt(algorithm, cryptoKey, dataToEncrypt);
    return { iv: uint8ArrayToHex(iv), data: arrayBufferToBase64(encrypted) };
  }

  async decrypt(payload, key) {
    const iv = hexToUint8Array(payload.iv);
    const encryptedData = base64ToArrayBuffer(payload.data);
    const algorithm = { name: 'AES-GCM', iv, tagLength: 128 };
    const cryptoKey = await crypto.subtle.importKey('raw', key, algorithm.name, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt(algorithm, cryptoKey, encryptedData);
    return new Uint8Array(decrypted);
  }
}
