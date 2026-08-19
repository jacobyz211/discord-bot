// src/lib/handlers.js
// Handle each Discord slash command by calling your Eclipse addon instances.
import {
  searchAll,
  resolveStream,
  fetchManifest,
} from './eclipse-client.js';
import {
  ResponseType,
  buildTrackEmbed,
  buildStreamEmbed,
  buildHealthEmbed,
} from './interactions.js';

/**
 * /play — search both addons, return top track + stream URL.
 */
export async function handlePlay(interaction, env) {
  const query = interaction.data.options?.find((o) => o.name === 'query')?.value;
  if (!query) {
    return { type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'No query provided.' } };
  }

  const results = await searchAll(env, query);
  const topTrack = results.tracks[0];
  if (!topTrack) {
    return {
      type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `No tracks found for "${query}" on either addon.` },
    };
  }

  const stream = await resolveStream(topTrack);
  if (!stream) {
    // Still show the track info even if stream resolution fails
    const embed = buildTrackEmbed(topTrack);
    return {
      type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `Found **${topTrack.title}** by ${topTrack.artist || 'Unknown'} but couldn't resolve a stream URL.`,
        embeds: [embed],
      },
    };
  }

  const embed = buildStreamEmbed(topTrack, stream);
  return {
    type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `▶ Playing from **${topTrack.source}**`,
      embeds: [embed],
    },
  };
}

/**
 * /search — return up to 10 matching tracks as embeds.
 */
export async function handleSearch(interaction, env) {
  const query = interaction.data.options?.find((o) => o.name === 'query')?.value;
  if (!query) {
    return { type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'No query provided.' } };
  }

  const results = await searchAll(env, query);
  const tracks = results.tracks.slice(0, 10);
  if (tracks.length === 0) {
    return {
      type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `No results for "${query}".` },
    };
  }

  const embeds = tracks.map((t, i) => buildTrackEmbed(t, i + 1));
  return {
    type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `Found **${results.tracks.length}** tracks for "${query}" — showing top ${tracks.length}:`,
      embeds,
    },
  };
}

/**
 * /stream — resolve a stream URL for a specific track ID + source.
 */
export async function handleStream(interaction, env) {
  const id = interaction.data.options?.find((o) => o.name === 'id')?.value;
  const source = interaction.data.options?.find((o) => o.name === 'source')?.value;
  if (!id || !source) {
    return { type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'Missing id or source.' } };
  }

  const manifestUrl = source === 'monochrome' ? env.MONOCHROME_URL : env.QOBUZ_TIDAL_URL;
  const track = {
    id,
    title: 'Requested track',
    artist: source,
    source,
    addonManifestUrl: manifestUrl,
  };

  const stream = await resolveStream(track);
  if (!stream) {
    return {
      type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `Couldn't resolve a stream for ID \`${id}\` on ${source}.` },
    };
  }

  const embed = buildStreamEmbed(track, stream);
  return {
    type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed] },
  };
}

/**
 * /health — check which addon instances are online by fetching their manifests.
 */
export async function handleHealth(interaction, env) {
  const [mono, qt] = await Promise.all([
    fetchManifest(env.MONOCHROME_URL),
    fetchManifest(env.QOBUZ_TIDAL_URL),
  ]);

  const statuses = [
    {
      name: 'monochrome',
      url: env.MONOCHROME_URL,
      online: !!mono,
      version: mono?.version,
    },
    {
      name: 'qobuz-tidal',
      url: env.QOBUZ_TIDAL_URL,
      online: !!qt,
      version: qt?.version,
    },
  ];

  const embed = buildHealthEmbed(statuses);
  return {
    type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed] },
  };
}
