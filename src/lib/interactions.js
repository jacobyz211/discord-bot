// src/lib/interactions.js
// Discord interaction-response helpers.
// On Cloudflare Workers we respond to Discord's HTTP interactions (type 1 PING,
// type 2 APPLICATION_COMMAND) and can send follow-up messages via webhook.

const DISCORD_API = 'https://discord.com/api/v10';

// Interaction response types
export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
};

/**
 * Send a follow-up message to an interaction (after deferring).
 * Interaction tokens are valid for 15 minutes.
 *
 * @param {string} applicationId
 * @param {string} interactionToken
 * @param {object} payload  Discord message payload (content, embeds, components)
 * @param {boolean} ephemeral
 */
export async function followUp(applicationId, interactionToken, payload, ephemeral = false) {
  const url = `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}`;
  const body = ephemeral ? { ...payload, flags: 64 } : payload;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Follow-up failed ${res.status}: ${text}`);
  }
  return res;
}

/**
 * Edit the original deferred response.
 */
export async function editOriginal(applicationId, interactionToken, payload) {
  const url = `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res;
}

/**
 * Build a Discord embed for a single search result (track).
 */
export function buildTrackEmbed(track, rank = null) {
  const title = rank ? `#${rank}  ${track.title}` : track.title;
  const fields = [
    { name: 'Artist', value: track.artist || 'Unknown', inline: true },
    { name: 'Source', value: track.source || 'unknown', inline: true },
  ];
  if (track.album) fields.push({ name: 'Album', value: track.album, inline: true });
  if (track.duration) {
    fields.push({ name: 'Duration', value: formatDuration(track.duration), inline: true });
  }
  if (track.format) {
    fields.push({ name: 'Format', value: track.format.toUpperCase(), inline: true });
  }
  if (track.isrc) {
    fields.push({ name: 'ISRC', value: track.isrc, inline: true });
  }

  const embed = {
    title,
    color: 0x1a1a1a,
    fields,
    footer: { text: `Track ID: ${track.id}` },
  };
  if (track.artworkURL) {
    embed.thumbnail = { url: track.artworkURL };
  }
  return embed;
}

/**
 * Build a compact embed for a stream URL result.
 */
export function buildStreamEmbed(track, stream) {
  const embed = {
    title: `🎵 ${track.title}`,
    description: track.artist || '',
    color: 0x00ff88,
    fields: [
      { name: 'Format', value: (stream.format || 'unknown').toUpperCase(), inline: true },
      { name: 'Quality', value: stream.quality || '—', inline: true },
      { name: 'Source', value: track.source || '—', inline: true },
    ],
    footer: { text: 'Copy the URL below to play in Eclipse or any player' },
  };
  if (stream.url) {
    embed.fields.push({ name: 'Stream URL', value: `\`${stream.url}\`` });
  }
  return embed;
}

/**
 * Build a health-check embed listing addon status.
 */
export function buildHealthEmbed(statuses) {
  const fields = statuses.map((s) => ({
    name: s.name,
    value: s.online ? `✅ Online — ${s.version || 'v?'}` : '❌ Offline',
    inline: false,
  }));
  return {
    title: 'Eclipse Addon Health',
    color: 0x5865f2,
    fields,
    timestamp: new Date().toISOString(),
  };
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
