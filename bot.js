import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} from '@discordjs/voice';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const MONOCHROME_URL = process.env.MONOCHROME_URL || 'https://monochrome.rickyaddons.dpdns.org/u/8fbda2f7515bcd0c88729198695e~~~SElNQVg/manifest.json';
const QOBUZ_TIDAL_URL = process.env.QOBUZ_TIDAL_URL || 'https://qobuz-tidal-eclipse.cyrusna29.workers.dev/u/wh4g2a1rxm2gugcfazlnwagkm57e/manifest.json';
const PREFERRED = 'monochrome';

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN env var');
  process.exit(1);
}

const queues = new Map();

function getBase(manifestUrl) {
  return manifestUrl.replace(/\/manifest\.json?$/, '').replace(/\/$/, '');
}

async function searchAddon(manifestUrl, query, sourceName) {
  const base = getBase(manifestUrl);
  const url = `${base}/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tracks || data.results || []).map((t) => ({
      ...t,
      source: sourceName,
      addonManifestUrl: manifestUrl,
    }));
  } catch {
    return [];
  }
}

async function searchAll(query) {
  const [mono, qt] = await Promise.all([
    searchAddon(MONOCHROME_URL, query, 'monochrome'),
    searchAddon(QOBUZ_TIDAL_URL, query, 'qobuz-tidal'),
  ]);
  const preferred = PREFERRED === 'qobuz-tidal' ? qt : mono;
  const other = PREFERRED === 'qobuz-tidal' ? mono : qt;
  const seen = new Set();
  const merged = [];
  for (const t of [...preferred, ...other]) {
    const key = `${(t.title || '').toLowerCase()}|${(t.artist || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }
  return merged;
}

async function resolveStream(track) {
  if (track.streamURL) return track.streamURL;
  const base = getBase(track.addonManifestUrl);
  const url = `${base}/stream/${encodeURIComponent(track.id)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || data.streamURL || null;
  } catch {
    return null;
  }
}

function playStream(connection, streamUrl, track) {
  const player = createAudioPlayer();

  const ffmpeg = spawn(ffmpegPath, [
    '-re',
    '-i', streamUrl,
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-f', 'opus',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '128k',
    'pipe:1',
  ]);

  const resource = createAudioResource(ffmpeg.stdout);
  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    const guildId = connection.joinConfig.guildId;
    const queue = queues.get(guildId);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      playStream(connection, next.streamUrl, next.track);
    }
  });

  player.on('error', (err) => console.error('Player error:', err.message));
  ffmpeg.on('error', (err) => console.error('ffmpeg error:', err.message));

  return player;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Search Eclipse addons and play in your voice channel')
    .addStringOption((o) =>
      o.setName('query').setDescription('Song title or artist').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue'),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`${client.user.tag} is online`);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`Registered ${commands.length} slash commands`);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'play') {
    const query = interaction.options.getString('query');
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply('You need to be in a voice channel first!');
      return;
    }

    await interaction.deferReply();

    const tracks = await searchAll(query);
    if (tracks.length === 0) {
      await interaction.editReply(`No tracks found for "${query}".`);
      return;
    }

    const track = tracks[0];
    const streamUrl = await resolveStream(track);
    if (!streamUrl) {
      await interaction.editReply(`Found **${track.title || 'track'}** but couldn't resolve a stream URL.`);
      return;
    }

    let connection = getVoiceConnection(interaction.guild.id);
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
    }

    const guildId = interaction.guild.id;
    const queue = queues.get(guildId) || [];
    for (let i = 1; i < Math.min(5, tracks.length); i++) {
      const s = await resolveStream(tracks[i]);
      if (s) queue.push({ track: tracks[i], streamUrl: s });
    }
    queues.set(guildId, queue);

    playStream(connection, streamUrl, track);

    const fmtStr = track.format ? ` [${track.format.toUpperCase()}]` : '';
    await interaction.editReply(
      `Now playing: **${track.title || 'Unknown'}** by ${track.artist || 'Unknown'}${fmtStr} from ${track.source}`
    );
  }

  if (interaction.commandName === 'skip') {
    const connection = getVoiceConnection(interaction.guild.id);
    if (!connection) {
      await interaction.reply('Nothing is playing.');
      return;
    }
    const queue = queues.get(interaction.guild.id) || [];
    if (queue.length > 0) {
      const next = queue.shift();
      playStream(connection, next.streamUrl, next.track);
      await interaction.reply(`Skipped! Now playing: **${next.track.title || 'Unknown'}**`);
    } else {
      await interaction.reply('Skipped! Queue is empty.');
    }
  }

  if (interaction.commandName === 'stop') {
    const connection = getVoiceConnection(interaction.guild.id);
    if (connection) {
      queues.set(interaction.guild.id, []);
      connection.destroy();
      await interaction.reply('Stopped playback and cleared the queue.');
    } else {
      await interaction.reply('Nothing is playing.');
    }
  }

  if (interaction.commandName === 'queue') {
    const queue = queues.get(interaction.guild.id) || [];
    if (queue.length === 0) {
      await interaction.reply('Queue is empty.');
      return;
    }
    const list = queue
      .map((q, i) => `${i + 1}. **${q.track.title || 'Unknown'}** - ${q.track.artist || 'Unknown'}`)
      .join('\n');
    await interaction.reply(`**Queue (${queue.length}):**\n${list}`);
  }
});

client.login(TOKEN);
