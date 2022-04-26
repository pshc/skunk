import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { Redis, lookupArena } from '../api';
import { adornName, dayRollKey, loadDoubler } from './roll';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('highscore')
  .setDescription('Show the xd100 rolling record.');

export async function execute(interaction: CommandInteraction) {
  const redis: Redis = (global as any).redis;
  const arena = lookupArena(interaction);

  const highScore = await redis.GET(`${arena}:maiden:high_score`) || '0';
  const highName = await redis.GET(`${arena}:maiden:high_name`) || '<nobody>';

  const today = dayRollKey(arena, 'today');
  const todayHigh = (await redis.GET(`${today}:score`)) || '0';
  const todayLow = (await redis.GET(`${today}:low`)) || '♾️';
  const todayHighName = (await redis.GET(`${today}:name`)) || '<nobody yet>';
  const todayLowName = (await redis.GET(`${today}:low_name`)) || '<nobody yet>';

  const yesterday = dayRollKey(arena, 'yesterday');
  const yesterdayHigh = (await redis.GET(`${yesterday}:score`)) || '0';
  const yesterdayLow = (await redis.GET(`${yesterday}:low`)) || '♾️';
  const champ = (await redis.GET(`${yesterday}:name`)) || '<nobody>';
  const brick = (await redis.GET(`${yesterday}:low_name`)) || '<nobody>';

  const hundoKey = `${arena}:maiden:hundo`;
  const hundo = await redis.GET(hundoKey) || '<nobody>';
  const hundoStreak = Number(await redis.GET(`${hundoKey}_streak`));

  const pooperKey = `${arena}:maiden:pooper`;
  const pooper = await redis.GET(pooperKey) || '<nobody>';
  const poopSuite = Number(await redis.GET(`${pooperKey}_streak`));

  const doubler = await loadDoubler(arena);

  const adorn = (name: string) =>
    adornName({ name, champ, brick, hundo, hundoStreak, pooper, poopSuite, doubler });

  // sort roll counts
  const rollCountsById = await redis.HGETALL(`${arena}:maiden:roll_counts`);
  const names = await redis.HGETALL(`${arena}:names`);
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

  await interaction.reply(`Today: ${todayHigh} by ${adorn(todayHighName)} / ${todayLow} by ${adorn(todayLowName)}
Yesterday: ${yesterdayHigh} by ${adorn(champ)} / ${yesterdayLow} by ${adorn(brick)}
All time: ${highScore} by ${adorn(highName)}
Rolls: ${countDescs.join(', ')}`);
}
