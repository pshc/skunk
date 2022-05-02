import { strict as assert } from 'assert';
import { readdirSync } from 'fs';
import { Client, Collection, CommandInteraction, Intents } from 'discord.js';
import Redis from 'ioredis';
import type { Command } from './api';
import { handleButton } from './buttons';
import { Sorry } from './utils';

require('dotenv').config();
const {
  DISCORD_BOT_TOKEN,
  DISCORD_CHANNEL_ID,
  REDIS_PASSWORD,
} = process.env;

// provide a global persistent redis store in `global.redis`
const redis = new Redis({ password: REDIS_PASSWORD });
(global as any).redis = redis;

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

function bot() {
  if (!DISCORD_BOT_TOKEN)
    throw new Error('DISCORD_BOT_TOKEN missing from .env!');
  client.login(DISCORD_BOT_TOKEN);
}

// we will populate this from `dist/commands/*.js`
const commands: Collection<string, Command> = new Collection();
(client as any).commands = commands;
const commandFiles = readdirSync('./dist/commands').filter((file: string) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.set(command.data.name, command);
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
});

client.once('invalidated', () => {
  console.error('Bot invalidated!');
  process.exit(1);
});

client.on('invalidRequestWarning', ({count, remainingTime}) => {
  console.warn(`Invalid requests: ${count}, remaining time ${remainingTime}`);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    await handleCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButton(interaction);
  }
});

async function handleCommand(interaction: CommandInteraction) {
  const { channelId, commandName } = interaction;
  if (DISCORD_CHANNEL_ID && DISCORD_CHANNEL_ID !== channelId) {
    const content = 'Wrong channel, sorry!';
    await interaction.reply({ content, ephemeral: true });
    return;
  }

  const command = commands.get(commandName);
  if (!command) {
    console.warn(`unregistered command ${commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error: any) {
    if (!(error instanceof Sorry)) {
      console.error(commandName, error);
    }
    if (error && error['code'] === 10062) {
      console.error('Another instance of the bot is already running?');
      process.exit(1);
    }
    const content = (error && error.message) || 'There was an error while executing this command!';
    await interaction.reply({ content, ephemeral: true });
  }
}

if (require.main === module) {
  bot();
}
