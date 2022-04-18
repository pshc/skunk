import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena } from '../api';
import { adornName, dayRollKey, loadDoubler } from './roll';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('highscore')
  .setDescription('Show the xd100 rolling record.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);

  const highScore = await redis.get(`${arena}:maiden:high_score`);
  const highName = await redis.get(`${arena}:maiden:high_name`);

  const today = dayRollKey(arena, 'today');
  const todayScore = (await redis.get(`${today}:score`)) || '0';
  const todayName = (await redis.get(`${today}:name`)) || '<nobody yet>';

  const yesterday = dayRollKey(arena, 'yesterday');
  const yesterdayHigh = (await redis.get(`${yesterday}:score`)) || '0';
  const yesterdayLow = (await redis.get(`${yesterday}:low`)) || '♾️';
  const champ = (await redis.get(`${yesterday}:name`)) || '<nobody>';
  const brick = (await redis.get(`${yesterday}:low_name`)) || '<nobody>';

  const hundoKey = `${arena}:maiden:hundo`;
  const hundo = await redis.get(hundoKey);
  const hundoStreak = Number(await redis.get(`${hundoKey}_streak`));

  const pooperKey = `${arena}:maiden:pooper`;
  const pooper = await redis.get(pooperKey);
  const poopSuite = Number(await redis.get(`${pooperKey}_streak`));

  const doubler = await loadDoubler(arena);

  const adorn = (name: string) =>
    adornName({ name, champ, brick, hundo, hundoStreak, pooper, poopSuite, doubler });

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
  const countDescs = counts.map(([name, count]) => `${adorn(name)} (${count})`);
  if (sum > 0) {
    countDescs.push(`Total: ${sum}`);
  }

  await interaction.reply(`Today: ${todayScore} by ${adorn(todayName)}
Yesterday: ${yesterdayHigh} by ${adorn(champ)} / ${yesterdayLow} by ${adorn(brick)}
All time: ${highScore} by ${adorn(highName)}
Rolls: ${countDescs.join(', ')}`);
}
