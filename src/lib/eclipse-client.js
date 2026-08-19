// src/lib/eclipse-client.js
// Thin client that hits your deployed Eclipse addon instances (monochrome and
// qobuz-tidal-eclipse) and returns normalized search + stream results.
//
// Both addons follow the Eclipse addon spec (https://eclipsemusic.app/docs):
//   GET /manifest.json
//   GET /search?q={query}
//   GET /stream/{id}
//   GET /album/{id}
//   GET /artist/{id}
//   GET /playlist/{id}

const TIMEOUT_MS = 5000;

/**
 * Fetch with a hard timeout so one slow addon never stalls the bot.
 */
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
 * Fetch the manifest from an addon to confirm it's alive.
 * @param {string} baseUrl  e.g. https://monochrome.rickyaddons.dpdns.org
 * @returns {Promise<object|null>}
 */
export async function fetchManifest(baseUrl) {
  try {
    const res = await fetchWithTimeout(`${trimSlash(baseUrl)}/manifest.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Search a single addon.
 * @param {string} baseUrl
 * @param {string} query
 * @param {string} sourceName  "monochrome" or "qobuz-tidal" — used to tag results
 * @returns {Promise<{tracks: Array, albums: Array, artists: Array}>}
 */
export async function searchAddon(baseUrl, query, sourceName) {
  const url = `${trimSlash(baseUrl)}/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { tracks: [], albums: [], artists: [] };
    const data = await res.json();
    return {
      tracks: (data.tracks || []).map((t) => ({
        ...t,
        source: sourceName,
        addonBaseUrl: baseUrl,
      })),
      albums: (data.albums || []).map((a) => ({
        ...a,
        source: sourceName,
        addonBaseUrl: baseUrl,
      })),
      artists: (data.artists || []).map((a) => ({
        ...a,
        source: sourceName,
        addonBaseUrl: baseUrl,
      })),
    };
  } catch {
    return { tracks: [], albums: [], artists: [] };
  }
}

/**
 * Search both addons in parallel, then merge results.
 * Preferred source's tracks come first.
 *
 * @param {object} env  Worker env (MONOCHROME_URL, QOBUZ_TIDAL_URL, PREFERRED_SOURCE)
 * @param {string} query
 * @returns {Promise<{tracks: Array, albums: Array, artists: Array}>}
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
 * If the search result already had streamURL, use it directly.
 * Otherwise call the addon's /stream/{id} endpoint.
 *
 * @param {object} track  normalized track object (must include `id`, `addonBaseUrl`)
 * @returns {Promise<{url: string, format?: string, quality?: string}|null>}
 */
export async function resolveStream(track) {
  if (track.streamURL) {
    return {
      url: track.streamURL,
      format: track.format || 'flac',
      quality: track.quality || 'lossless',
    };
  }

  const url = `${trimSlash(track.addonBaseUrl)}/stream/${encodeURIComponent(track.id)}`;
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
 * Fetch album tracks for browsing.
 * @param {string} baseUrl
 * @param {string} albumId
 */
export async function fetchAlbum(baseUrl, albumId) {
  const url = `${trimSlash(baseUrl)}/album/${encodeURIComponent(albumId)}`;
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
 * @param {string} baseUrl
 * @param {string} artistId
 */
export async function fetchArtist(baseUrl, artistId) {
  const url = `${trimSlash(baseUrl)}/artist/${encodeURIComponent(artistId)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Remove duplicate tracks by (title + artist) — keeps the preferred-source copy. */
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

/** Strip trailing slash from a URL. */
function trimSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
