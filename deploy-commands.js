require('dotenv').config();

const fs = require('fs');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  // load *.js files in `dist/commands`
  const commandFiles = fs.readdirSync('./dist/commands').filter(file => file.endsWith('.js'));
  const commands = commandFiles.map(file => require(`./dist/commands/${file}`).data.toJSON());

  // register them with discord
  try {
    console.log('Started refreshing application (/) commands.');

    const { DISCORD_APP_ID, DISCORD_GUILD_ID } = process.env;
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_APP_ID, DISCORD_GUILD_ID),
      { body: commands },
    );

    console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
  } catch (error) {
    console.error(error);
  }
})();
