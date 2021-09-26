require('dotenv').config();

const fs = require('fs');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_BOT_TOKEN);

const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
const commands = commandFiles.map(file => require(`./commands/${file}`).data.toJSON());

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    const { DISCORD_APP_ID, DISCORD_GUILD_ID } = process.env;
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_APP_ID, DISCORD_GUILD_ID),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
