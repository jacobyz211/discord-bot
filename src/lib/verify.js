// src/lib/verify.js
// Discord Ed25519 signature verification — works on Cloudflare Workers WebCrypto API
// Discord signs every interaction request with Ed25519; the endpoint must verify
// or Discord will reject the URL.

/**
 * Verify Discord interaction signature.
 * @param {string} publicKey  64-byte hex Ed25519 public key from Discord Developer Portal
 * @param {string} signature  hex signature from x-signature-ed25519 header
 * @param {string} timestamp  from x-signature-timestamp header
 * @param {string} body       raw request body text
 * @returns {Promise<boolean>}
 */
export async function verifyDiscordRequest(publicKey, signature, timestamp, body) {
  if (!publicKey || !signature || !timestamp || !body) return false;

  // Discord sends a 64-byte Ed25519 signature.
  // Cloudflare Workers WebCrypto supports NODE-ED25519 / EdDSA via importKey.
  const keyData = hexToBytes(publicKey);
  const sigBytes = hexToBytes(signature);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
    false,
    ['verify']
  );

  const message = new TextEncoder().encode(timestamp + body);

  const valid = await crypto.subtle.verify(
    { name: 'NODE-ED25519' },
    key,
    sigBytes,
    message
  );

  return valid;
}

/** Convert a hex string to Uint8Array. */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
