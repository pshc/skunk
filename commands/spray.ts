import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('spray')
    .setDescription('Emit that funk!');

export async function execute(interaction: CommandInteraction) {
  const redis = (global as any).redis;
  const counter = await redis.incr('spray:count');
  await interaction.reply(`Skunk has sprayed the stank ${counter} times!`);
}
