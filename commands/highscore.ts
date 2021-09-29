import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { Arena, PlayerId, lookupArena } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('highscore')
    .setDescription('Show the xd100 rolling record.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);

  const highScore = await redis.get(`${arena}:maiden:high_score`);
  const highName = await redis.get(`${arena}:maiden:high_name`);
  const diceCount = await redis.get(`${arena}:maiden:dice_count`);
  await interaction.reply(`High score: ${highScore} by ${highName}
Currently rolling ${diceCount}d100.`);
}
