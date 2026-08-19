// src/index.js
// Main Cloudflare Worker entry point.
// Receives Discord HTTP interactions, verifies the Ed25519 signature,
// and routes to command handlers that hit your deployed Eclipse addon instances.
import { verifyDiscordRequest } from './lib/verify.js';
import { handlePlay, handleSearch, handleStream, handleHealth } from './lib/handlers.js';
import { ResponseType } from './lib/interactions.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Health probe endpoint (for uptime monitors) ──────────────────
    if (url.pathname === '/_health') {
      return new Response('ok', { status: 200 });
    }

    // ── Discord interactions endpoint ─────────────────────────────────
    if (url.pathname === '/interactions') {
      return handleInteraction(request, env);
    }

    // ── Simple landing page at root ──────────────────────────────────
    return new Response(landingPage(env), {
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

async function handleInteraction(request, env) {
  // Discord sends the signature in headers; body is raw text.
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();

  // 1. Verify signature — required or Discord disables the endpoint.
  const isValid = await verifyDiscordRequest(
    env.DISCORD_PUBLIC_KEY,
    signature,
    timestamp,
    body
  );
  if (!isValid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(body);

  // 2. PING — Discord sends this when verifying the endpoint URL.
  if (interaction.type === 1) {
    return json({ type: 1 }); // PONG
  }

  // 3. Slash command
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
        data: { content: `⚠️ Error running /${commandName}: ${err.message}` },
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

function landingPage(env) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Eclipse Discord Bot</title></head>
<body style="font-family:system-ui;background:#1a1a1a;color:#e0e0e0;padding:2rem">
<h1>🎵 Eclipse Discord Bot</h1>
<p>Routes Discord slash commands to your Eclipse music addon instances.</p>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>Addon</th><th>URL</th></tr>
<tr><td>monochrome</td><td><a href="${env.MONOCHROME_URL}/manifest.json" style="color:#6cb6ff">${env.MONOCHROME_URL}</a></td></tr>
<tr><td>qobuz-tidal</td><td><a href="${env.QOBUZ_TIDAL_URL}/manifest.json" style="color:#6cb6ff">${env.QOBUZ_TIDAL_URL}</a></td></tr>
</table>
<h3>Commands</h3>
<ul>
  <li><code>/play query: "song name"</code> — search both addons, return top track + stream URL</li>
  <li><code>/search query: "artist"</code> — list up to 10 matching tracks</li>
  <li><code>/stream id: "track_id" source: monochrome|qobuz-tidal</code> — resolve a direct stream URL</li>
  <li><code>/health</code> — check which addon instances are online</li>
</ul>
<h3>Interactions Endpoint</h3>
<p>Set this URL in the Discord Developer Portal → your app → Interactions Endpoint URL:</p>
<code>https://<your-worker>.workers.dev/interactions</code>
</body>
</html>`;
}
