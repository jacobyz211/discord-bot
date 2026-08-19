// src/lib/commands.js
// Define the Discord slash commands the bot registers.
// These are sent to Discord's API via PUT /applications/{app_id}/commands.

export const COMMAND_PLAY = {
  name: 'play',
  description: 'Search both Eclipse addons and play the top result',
  options: [
    {
      type: 3, // STRING
      name: 'query',
      description: 'Song title, artist, or album',
      required: true,
    },
  ],
};

export const COMMAND_SEARCH = {
  name: 'search',
  description: 'Search Eclipse addons (monochrome + qobuz-tidal) without playing',
  options: [
    {
      type: 3, // STRING
      name: 'query',
      description: 'What to search for',
      required: true,
    },
  ],
};

export const COMMAND_STREAM = {
  name: 'stream',
  description: 'Resolve and show a direct stream URL for a track ID',
  options: [
    {
      type: 3, // STRING
      name: 'id',
      description: 'Track ID from search results',
      required: true,
    },
    {
      type: 3, // STRING
      name: 'source',
      description: 'Which addon the track lives on',
      required: true,
      choices: [
        { name: 'monochrome', value: 'monochrome' },
        { name: 'qobuz-tidal', value: 'qobuz-tidal' },
      ],
    },
  ],
};

export const COMMAND_HEALTH = {
  name: 'health',
  description: 'Check which Eclipse addon instances are online',
};

export const ALL_COMMANDS = [
  COMMAND_PLAY,
  COMMAND_SEARCH,
  COMMAND_STREAM,
  COMMAND_HEALTH,
];
