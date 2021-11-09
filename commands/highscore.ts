import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena } from '../api';
import { todayRollKey } from './roll';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('highscore')
    .setDescription('Show the xd100 rolling record.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);

  const highScore = await redis.get(`${arena}:maiden:high_score`);
  const highName = await redis.get(`${arena}:maiden:high_name`);
  const diceCount = await redis.get(`${arena}:maiden:dice_count`);

  const today = todayRollKey(arena);
  const todayScore = (await redis.get(`${today}:score`)) || '0';
  const todayName = (await redis.get(`${today}:name`)) || '<nobody yet>';

  // sort roll counts
  const rollCountsById = await redis.hgetall(`${arena}:maiden:roll_counts`);
  const names = await redis.hgetall(`${arena}:names`);
  const counts: [string, number][] = [];
  let sum = 0;
  for (let rollerId in rollCountsById) {
    const rollerCount = Number(rollCountsById[rollerId]);
    counts.push([names[rollerId], rollerCount]);
    sum += rollerCount;
  }
  counts.sort(([_a, countA], [_b, countB]) => countA - countB);
  const countDescs = counts.map(([name, count]) => `${name} (${count})`);
  if (sum > 0) {
    countDescs.push(`Total: ${sum}`);
  }

  await interaction.reply(`High score: ${highScore} by ${highName}
Today: ${todayScore} by ${todayName}
Currently rolling ${diceCount}d100.
Rolls: ${countDescs.join(', ')}`);
}
