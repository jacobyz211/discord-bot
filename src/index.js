// src/index.js
// Main Cloudflare Worker entry point.
import nacl from 'tweetnacl';
import { handlePlay, handleSearch, handleStream, handleHealth } from './lib/handlers.js';
import { ResponseType } from './lib/interactions.js';
import { ALL_COMMANDS } from './lib/commands.js';
import { searchAddon, fetchManifest, resolveStream } from './lib/eclipse-client.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/_health') {
      return new Response('ok', { status: 200 });
    }

    if (url.pathname === '/interactions') {
      return handleInteraction(request, env);
    }

    // Register slash commands — visit this URL in a browser
    if (url.pathname === '/register') {
      return handleRegister(env);
    }

    // Debug route — visit /debug?q=travis+scott in browser to see raw addon responses
    if (url.pathname === '/debug') {
      return handleDebug(request, env);
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

  if (interaction.type === 1) {
    return json({ type: 1 });
  }

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
 * Debug route — visit /debug?q=travis+scott in your phone browser.
 * Shows the raw response from each addon so you can see exactly what's coming back.
 */
async function handleDebug(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || 'travis scott';

  // Fetch manifests + search from both addons in parallel
  const [monoManifest, qtManifest, monoSearch, qtSearch] = await Promise.all([
    fetchManifest(env.MONOCHROME_URL),
    fetchManifest(env.QOBUZ_TIDAL_URL),
    fetchAddonRaw(env.MONOCHROME_URL, query),
    fetchAddonRaw(env.QOBUZ_TIDAL_URL, query),
  ]);

  return new Response(debugPage(query, {
    monochrome: { manifest: monoManifest, search: monoSearch },
    qobuzTidal: { manifest: qtManifest, search: qtSearch },
  }), {
    headers: { 'Content-Type': 'text/html' },
  });
}

/** Fetch raw search response from an addon — returns {status, body, error} */
async function fetchAddonRaw(baseUrl, query) {
  const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return {
      url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      rawText: text.slice(0, 2000),
      parsed,
    };
  } catch (err) {
    return { url, error: err.message };
  }
}

/**
 * Register slash commands by visiting /register in a browser.
 * Automatically retries on rate limit (429).
 */
async function handleRegister(env) {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = env.DISCORD_APPLICATION_ID;

  if (!token || !appId) {
    return new Response(
      registerPage('error', 'Missing secrets: DISCORD_BOT_TOKEN and/or DISCORD_APPLICATION_ID are not set. Go to Cloudflare dashboard → your Worker → Settings → Variables and Secrets, and add them as Secrets.'),
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  const apiUrl = `https://discord.com/api/v10/applications/${appId}/commands`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(apiUrl, {
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
        return new Response(
          registerPage('success', cmdList),
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      if (res.status === 429) {
        const errorData = await res.json();
        const retryAfter = (errorData.retry_after || 5) * 1000;
        if (attempt < maxRetries) {
          await sleep(retryAfter + 500);
          continue;
        } else {
          return new Response(
            registerPage('error', `Still rate limited after ${maxRetries} attempts. Wait 30 seconds and refresh this page.`),
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
      }

      const text = await res.text();
      return new Response(
        registerPage('error', `Discord API returned ${res.status}: ${text}`),
        { headers: { 'Content-Type': 'text/html' } }
      );
    } catch (err) {
      return new Response(
        registerPage('error', `Request failed: ${err.message}`),
        { headers: { 'Content-Type': 'text/html' } }
      );
    }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  <li><a href="/debug?q=travis+scott" style="color:#6cb6ff">Debug: test addon search →</a></li>
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

function debugPage(query, data) {
  const sections = [];

  for (const [name, info] of Object.entries(data)) {
    const manifestStr = info.manifest
      ? `<pre style="background:#222;padding:0.75rem;overflow-x:auto;font-size:0.8rem;border-radius:4px">${escapeHtml(JSON.stringify(info.manifest, null, 2))}</pre>`
      : '<p style="color:#f87171">❌ No manifest returned</p>';

    const search = info.search;
    let searchStr;
    if (search.error) {
      searchStr = `<p style="color:#f87171">❌ Error: ${escapeHtml(search.error)}</p>`;
    } else {
      const trackCount = search.parsed?.tracks?.length ?? '— (no tracks array)';
      searchStr = `
        <p><strong>URL:</strong> <code style="word-break:break-all">${escapeHtml(search.url)}</code></p>
        <p><strong>Status:</strong> ${search.status} | <strong>Content-Type:</strong> ${escapeHtml(search.contentType || '—')}</p>
        <p><strong>Tracks found:</strong> ${trackCount}</p>
        <details>
          <summary style="cursor:pointer;color:#6cb6ff">Raw response (first 2000 chars) →</summary>
          <pre style="background:#222;padding:0.75rem;overflow-x:auto;font-size:0.75rem;border-radius:4px;white-space:pre-wrap;word-break:break-all">${escapeHtml(search.rawText)}</pre>
        </details>
        ${search.parsed ? `
        <details>
          <summary style="cursor:pointer;color:#6cb6ff">Parsed JSON →</summary>
          <pre style="background:#222;padding:0.75rem;overflow-x:auto;font-size:0.75rem;border-radius:4px;white-space:pre-wrap;word-break:break-all">${escapeHtml(JSON.stringify(search.parsed, null, 2).slice(0, 3000))}</pre>
        </details>` : ''}
      `;
    }

    sections.push(`
      <div style="border:1px solid #444;border-radius:8px;padding:1rem;margin-bottom:1.5rem">
        <h2 style="color:#6cb6ff">${name}</h2>
        <h3>Manifest</h3>
        ${manifestStr}
        <h3>Search: "${escapeHtml(query)}"</h3>
        ${searchStr}
      </div>
    `);
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Debug</title></head>
<body style="font-family:system-ui;background:#1a1a1a;color:#e0e0e0;padding:1.5rem;max-width:800px;margin:auto">
<h1>🔍 Debug: Addon Responses</h1>
<p>Query: <strong>"${escapeHtml(query)}"</strong></p>
<form method="get" action="/debug" style="margin:1rem 0">
  <input name="q" placeholder="Search query..." value="${escapeHtml(query)}" style="padding:0.5rem;width:60%;background:#333;color:#fff;border:1px solid #555;border-radius:4px">
  <button type="submit" style="padding:0.5rem 1rem;background:#5865f2;color:#fff;border:none;border-radius:4px">Test</button>
</form>
${sections.join('')}
<hr style="border-color:#444">
<a href="/" style="color:#6cb6ff">← Back to bot homepage</a>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
