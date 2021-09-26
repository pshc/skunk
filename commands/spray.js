const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spray')
    .setDescription('Emit that funk!'),
  async execute(interaction) {
    const counter = await global.redis.incr('spray:count');
    await interaction.reply(`Skunk has sprayed the stank ${counter} times!`);
  },
};
