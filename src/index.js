// src/index.js
// Main Cloudflare Worker entry point.
import nacl from 'tweetnacl';
import { handlePlay, handleSearch, handleStream, handleHealth } from './lib/handlers.js';
import { ResponseType } from './lib/interactions.js';
import { ALL_COMMANDS } from './lib/commands.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health probe for uptime monitors
    if (url.pathname === '/_health') {
      return new Response('ok', { status: 200 });
    }

    // Discord interactions endpoint
    if (url.pathname === '/interactions') {
      return handleInteraction(request, env);
    }

    // Register slash commands — visit this URL in a browser
    if (url.pathname === '/register') {
      return handleRegister(env);
    }

    return new Response(landingPage(env), {
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

async function handleInteraction(request, env) {
  const body = await request.text();
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

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

  const interaction = JSON.parse(body);

  // PING — Discord sends type 1 when verifying the endpoint URL
  if (interaction.type === 1) {
    return json({ type: 1 });
  }

  // Slash command (type 2)
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

/**
 * Register slash commands by visiting /register in a browser.
 * Uses the DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID secrets.
 */
async function handleRegister(env) {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = env.DISCORD_APPLICATION_ID;

  if (!token || !appId) {
    return new Response(registerPage('error', 'Missing secrets: DISCORD_BOT_TOKEN and/or DISCORD_APPLICATION_ID are not set. Run:\n\nwrangler secret put DISCORD_BOT_TOKEN\nwrangler secret put DISCORD_APPLICATION_ID'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  try {
    const url = `https://discord.com/api/v10/applications/${appId}/commands`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ALL_COMMANDS),
    });

    if (res.ok) {
      const data = await res.json();
      const cmdList = data.map(c => `✅ /${c.name} — ${c.description}`).join('<br>');
      return new Response(registerPage('success', cmdList), {
        headers: { 'Content-Type': 'text/html' },
      });
    } else {
      const text = await res.text();
      return new Response(registerPage('error', `Discord API returned ${res.status}: ${text}`), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  } catch (err) {
    return new Response(registerPage('error', `Request failed: ${err.message}`), {
      headers: { 'Content-Type': 'text/html' },
    });
  }
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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eclipse Discord Bot</title></head>
<body style="font-family:system-ui;background:#1a1a1a;color:#e0e0e0;padding:1.5rem;max-width:600px;margin:auto">
<h1>🎵 Eclipse Discord Bot</h1>
<p>Routes Discord slash commands to your Eclipse music addon instances.</p>
<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
<tr><th>Addon</th><th>URL</th></tr>
<tr><td>monochrome</td><td style="word-break:break-all">${env.MONOCHROME_URL}</td></tr>
<tr><td>qobuz-tidal</td><td style="word-break:break-all">${env.QOBUZ_TIDAL_URL}</td></tr>
</table>
<h3>Commands</h3>
<ul>
  <li><code>/play</code> — search & play top result</li>
  <li><code>/search</code> — list up to 10 tracks</li>
  <li><code>/stream</code> — resolve a direct stream URL</li>
  <li><code>/health</code> — check addon status</li>
</ul>
<h3>Setup</h3>
<ol>
  <li><a href="/register" style="color:#6cb6ff">Register slash commands →</a></li>
  <li>Set interactions URL in Discord Portal: <code>/interactions</code></li>
  <li>Invite bot via OAuth2 (bot + applications.commands scopes)</li>
</ol>
</body>
</html>`;
}

function registerPage(status, message) {
  const bg = status === 'success' ? '#1a3a1a' : '#3a1a1a';
  const color = status === 'success' ? '#4ade80' : '#f87171';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Register Commands</title></head>
<body style="font-family:system-ui;background:${bg};color:${color};padding:1.5rem;max-width:600px;margin:auto">
<h1>Command Registration</h1>
<div style="font-size:1.1rem;line-height:1.8">${message}</div>
<hr style="margin:1.5rem 0;border-color:#444">
<a href="/" style="color:#6cb6ff">← Back to bot homepage</a>
</body>
</html>`;
}
