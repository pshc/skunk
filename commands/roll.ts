import { promises as fsAsync } from 'fs';
import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Try for the max score on xd100.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);
  const name = await redis.hget(`${arena}:names`, playerId) || '???';

  // prevent consecutive rolls
  const prevKey = `${arena}:maiden:previous_roller`;
  const prevRoller = await redis.get(prevKey);
  if (prevRoller === playerId) {
    await interaction.reply({ content: 'The dice are hot!', ephemeral: true });
    return;
  }

  // load the game state
  const countKey = `${arena}:maiden:dice_count`;
  let diceCount = Number(await redis.get(countKey));
  if (!diceCount || diceCount < 1) {
    redis.set(countKey, '1');
    diceCount = 1;
  }

  // roll xd100
  const rolls = [];
  let sum = 0;
  let isMaxRoll = true;
  for (let i = 0; i < diceCount; i++) {
    const roll = randomInt(100) + 1;
    if (roll < 100) {
      isMaxRoll = false;
    }
    rolls.push(roll);
    sum += roll;
  }

  // announce result
  if (isMaxRoll) {
    await redis.incr(countKey); // increase target number of dice
    await interaction.reply(`${name} MAX ROLL: \`${rolls}\` Result: ${sum}`);
    await redis.del(prevKey);
  } else {
    await interaction.reply(`${name} Roll: \`${rolls}\` Result: ${sum}`);
    // don't let them re-roll consecutively
    await redis.set(prevKey, playerId);
  }

  // update high score
  const oldHighScore = Number(await redis.get(`${arena}:maiden:high_score`));
  if (!oldHighScore || oldHighScore < sum) {
    await redis.set(`${arena}:maiden:high_score`, sum);
    await redis.set(`${arena}:maiden:high_name`, name);
  }

  // update roll count
  await redis.hincrby(`${arena}:maiden:roll_counts`, playerId, 1);

  // record the roll
  const csv = `rolls_${arena}_${diceCount}d100.csv`;
  const now = new Date().toISOString();
  await fsAsync.appendFile(csv, `${rolls.join(',')},${now},${name}\n`);
}
