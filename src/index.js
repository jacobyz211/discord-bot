// src/index.js
// Main Cloudflare Worker entry point.
import nacl from 'tweetnacl';
import { handlePlay, handleSearch, handleStream, handleHealth } from './lib/handlers.js';
import { ResponseType } from './lib/interactions.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Simple health probe for uptime monitors
    if (url.pathname === '/_health') {
      return new Response('ok', { status: 200 });
    }

    if (url.pathname === '/interactions') {
      return handleInteraction(request, env);
    }

    return new Response(landingPage(env), {
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

async function handleInteraction(request, env) {
  // Read the RAW body text — must be unparsed for signature verification.
  const body = await request.text();
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

  // 1. Verify signature — if this fails, Discord rejects the endpoint.
  if (!signature || !timestamp) {
    return new Response('Missing signature headers', { status: 401 });
  }

  let isValid = false;
  try {
    const keyBytes = hexToBytes(env.DISCORD_PUBLIC_KEY);
    const sigBytes = hexToBytes(signature);
    const message = new TextEncoder().encode(timestamp + body);
    isValid = nacl.sign.detached.verify(message, sigBytes, keyBytes);
  } catch (err) {
    console.error('Verify threw:', err);
    return new Response('Signature verification failed', { status: 401 });
  }

  if (!isValid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  // 2. Parse the now-verified body.
  const interaction = JSON.parse(body);

  // 3. PING — Discord sends type 1 when verifying the endpoint URL.
  //    Must respond with { type: 1 } exactly.
  if (interaction.type === 1) {
    return json({ type: 1 });
  }

  // 4. Slash command (type 2)
  if (interaction.type === 2) {
    const commandName = interaction.data?.name;
    let response;

    try {
      switch (commandName) {
        case 'play':
          response = await handlePlay(interaction, env);
          break;
        case 'search':
          response = await handleSearch(interaction, env);
          break;
        case 'stream':
          response = await handleStream(interaction, env);
          break;
        case 'health':
          response = await handleHealth(interaction, env);
          break;
        default:
          response = {
            type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `Unknown command: ${commandName}` },
          };
      }
    } catch (err) {
      console.error(`Command ${commandName} failed:`, err);
      response = {
        type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Error running /${commandName}: ${err.message}` },
      };
    }

    return json(response);
  }

  return new Response('Unknown interaction type', { status: 400 });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function landingPage(env) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Eclipse Discord Bot</title></head>
<body style="font-family:system-ui;background:#1a1a1a;color:#e0e0e0;padding:2rem">
<h1>Eclipse Discord Bot</h1>
<p>Routes Discord slash commands to your Eclipse music addon instances.</p>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>Addon</th><th>URL</th></tr>
<tr><td>monochrome</td><td><a href="${env.MONOCHROME_URL}/manifest.json" style="color:#6cb6ff">${env.MONOCHROME_URL}</a></td></tr>
<tr><td>qobuz-tidal</td><td><a href="${env.QOBUZ_TIDAL_URL}/manifest.json" style="color:#6cb6ff">${env.QOBUZ_TIDAL_URL}</a></td></tr>
</table>
<h3>Interactions Endpoint</h3>
<p>Set this URL in Discord Developer Portal &rarr; Interactions Endpoint URL:</p>
<code>https://discord-bot.cyrusna29.workers.dev/interactions</code>
</body>
</html>`;
}
