// src/lib/verify.js
// Discord Ed25519 signature verification using tweetnacl (pure JS, no WebCrypto).
// This is the same approach the official discord-interactions npm package uses.
// IMPORTANT: the body MUST be the raw request text, NOT parsed JSON —
// any whitespace change invalidates the signature.

import nacl from 'tweetnacl';

/**
 * Verify a Discord interaction request signature.
 *
 * @param {string} publicKey  64-byte hex Ed25519 public key from Discord Developer Portal
 * @param {string} signature  hex signature from X-Signature-Ed25519 header
 * @param {string} timestamp  from X-Signature-Timestamp header
 * @param {string} body       raw request body (await request.text())
 * @returns {boolean}
 */
export function verifyDiscordRequest(publicKey, signature, timestamp, body) {
  if (!publicKey || !signature || !timestamp || !body) return false;

  try {
    const sigBytes = hexToBytes(signature);
    const keyBytes = hexToBytes(publicKey);
    const message = new TextEncoder().encode(timestamp + body);
    return nacl.sign.detached.verify(message, sigBytes, keyBytes);
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
