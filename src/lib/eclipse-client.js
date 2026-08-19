// src/lib/eclipse-client.js
// Client for Eclipse addon instances.
// Handles token-based URLs like:
//   https://addon.example/u/{token}/manifest.json
// The bot stores the full manifest URL; this module strips /manifest.json
// to get the base, then appends /search, /stream/{id}, etc.

const TIMEOUT_MS = 8000;

/**
 * Extract the base URL (everything before /manifest.json) from a manifest URL.
 * @param {string} manifestUrl
 * @returns {string}
 */
function getBaseUrl(manifestUrl) {
  const url = manifestUrl.replace(/\/$/, '');
  if (url.endsWith('/manifest.json')) {
    return url.slice(0, -'/manifest.json'.length);
  }
  if (url.endsWith('/manifest')) {
    return url.slice(0, -'/manifest'.length);
  }
  return url;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the manifest from an addon.
 * @param {string} manifestUrl  Full URL ending in /manifest.json
 */
export async function fetchManifest(manifestUrl) {
  try {
    const res = await fetchWithTimeout(manifestUrl);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Search a single addon.
 * @param {string} manifestUrl  Full manifest URL
 * @param {string} query
 * @param {string} sourceName  "monochrome" or "qobuz-tidal"
 */
export async function searchAddon(manifestUrl, query, sourceName) {
  const base = getBaseUrl(manifestUrl);
  const url = `${base}/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { tracks: [], albums: [], artists: [] };
    const data = await res.json();
    return {
      tracks: (data.tracks || data.results || []).map((t) => ({
        ...t,
        source: sourceName,
        addonManifestUrl: manifestUrl,
      })),
      albums: (data.albums || []).map((a) => ({
        ...a,
        source: sourceName,
        addonManifestUrl: manifestUrl,
      })),
      artists: (data.artists || []).map((a) => ({
        ...a,
        source: sourceName,
        addonManifestUrl: manifestUrl,
      })),
    };
  } catch {
    return { tracks: [], albums: [], artists: [] };
  }
}

/**
 * Search both addons in parallel, merge results.
 * Preferred source's tracks come first.
 */
export async function searchAll(env, query) {
  const [mono, qt] = await Promise.all([
    searchAddon(env.MONOCHROME_URL, query, 'monochrome'),
    searchAddon(env.QOBUZ_TIDAL_URL, query, 'qobuz-tidal'),
  ]);

  const preferred = env.PREFERRED_SOURCE === 'qobuz-tidal' ? qt : mono;
  const other = env.PREFERRED_SOURCE === 'qobuz-tidal' ? mono : qt;

  return {
    tracks: dedupeTracks([...preferred.tracks, ...other.tracks]),
    albums: [...preferred.albums, ...other.albums],
    artists: [...preferred.artists, ...other.artists],
  };
}

/**
 * Resolve a playable stream URL for a track.
 * Uses the track's addonManifestUrl to build the stream endpoint.
 */
export async function resolveStream(track) {
  if (track.streamURL) {
    return {
      url: track.streamURL,
      format: track.format || 'flac',
      quality: track.quality || 'lossless',
    };
  }

  const base = getBaseUrl(track.addonManifestUrl);
  const url = `${base}/stream/${encodeURIComponent(track.id)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.url) return null;
    return {
      url: data.url,
      format: data.format || track.format || 'flac',
      quality: data.quality || 'lossless',
    };
  } catch {
    return null;
  }
}

/**
 * Fetch album details.
 */
export async function fetchAlbum(manifestUrl, albumId) {
  const base = getBaseUrl(manifestUrl);
  const url = `${base}/album/${encodeURIComponent(albumId)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch artist details.
 */
export async function fetchArtist(manifestUrl, artistId) {
  const base = getBaseUrl(manifestUrl);
  const url = `${base}/artist/${encodeURIComponent(artistId)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function dedupeTracks(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const key = `${(t.title || '').toLowerCase()}|${(t.artist || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
