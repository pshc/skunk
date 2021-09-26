const fs = require('fs');
const { Client, Collection, Intents } = require('discord.js');

// provide a global persistent redis store in `global.redis`
global.redis = require('async-redis').createClient();

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.once('invalidated', () => {
  console.error('Bot invalidated!');
  process.exit(1);
});

client.on('invalidRequestWarning', ({count, remainingTime}) => {
  console.warn(`Invalid requests: ${count}, remaining time ${remainingTime}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) {
    return;
  }
  const { commandName } = interaction;
  const command = client.commands.get(commandName);
  if (!command) {
    console.warn(`unregistered command ${commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const content = 'There was an error while executing this command!';
    await interaction.reply({ content, ephemeral: true });
  }
});

if (require.main === module) {
  require('dotenv').config();
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token)
    throw new Error('DISCORD_BOT_TOKEN missing from .env!');
  client.login(token);
}
