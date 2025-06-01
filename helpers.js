// Polyfills para Node.js
if (typeof btoa === 'undefined' && typeof Buffer !== 'undefined') {
  global.btoa = function (str) { return Buffer.from(str, 'binary').toString('base64'); };
}
if (typeof atob === 'undefined' && typeof Buffer !== 'undefined') {
  global.atob = function (b64Encoded) { return Buffer.from(b64Encoded, 'base64').toString('binary'); };
}

// Asegurar disponibilidad de crypto
if (typeof crypto === 'undefined' && typeof require !== 'undefined') {
    const nodeCrypto = require('node:crypto');
    if (!globalThis.crypto) {
        globalThis.crypto = nodeCrypto.webcrypto;
    }
}

export function hexToUint8Array(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('CLIENT_HELPER_INVALID_HEX_STRING');
  }
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16));
}

export function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary_string = atob(base64);
  const bytes = new Uint8Array(binary_string.length);
  for (let i = 0; i < binary_string.length; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}
