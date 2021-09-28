import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { ItemId, lookupArena } from '../api';
import { updateHighScore } from './score';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('cookie')
    .setDescription('Click for a cookie.');

data.addStringOption(option =>
  option.setName('difficulty')
    .setDescription('Set the difficulty level of your bonus skill checks.')
    .setRequired(true)
    .addChoices([
      ["random", "random"],
      ["easy", "easy"], ["medium", "medium"],
      ["hard", "hard"], ["very hard", "very hard"], ["nearly impossible", "nearly impossible"]
    ])
);

const DIFFICULTIES = {
  'easy': 1, 'medium': 2,
  'hard': 3, 'very hard': 4, 'nearly impossible': 5,
};

const LINE_LENGTH = 30;

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await redis.hget(`${arena}:discord_users`, interaction.user.id);
  if (!playerId) {
    throw new Error('Not playing');
  }
  const difficultyName = interaction.options.getString('difficulty');
  // the exponent will increase later and be used to calculate the multiplier
  let exponent: number = difficultyName === 'random' ? randomInt(6) : (DIFFICULTIES as any)[difficultyName];
  exponent = Math.max(0, Math.min(5, exponent));
  const difficulty = Math.max(5, Math.min(30, (exponent + 1) * 5));

  const cooldownKey = `${arena}:cookie_cooldown:${playerId}`;
  const didSet = await redis.set(cooldownKey, '1', 'NX', 'EX', '20');
  if (didSet !== 'OK') {
    const ttl = await redis.ttl(cooldownKey);
    await interaction.reply({ content: `Cookie on cooldown for ${ttl}sec`, ephemeral: true });
    return;
  }

  // roll and add 'em
  const a = randomInt(6) + 1;
  const b = randomInt(6) + 1;
  const roll = BigInt(a + b);
  const outcome = [`  ${a} + ${b}.`];
  let totalAward = roll;

  // apply inventory bonuses
  const inventory = `${arena}:inventory:${playerId}`;
  const itemIds: ItemId[] = await redis.smembers(inventory);
  if (itemIds.length > 0) {
    // initial multiplier derived from difficulty class
    outcome.push(`+ ${exponent} ${difficultyName}`);
    // each item has a chance to add to the multiplier
    let anySuccess = false;
    // we'll build up lines incrementally and flush them when they're long
    let plusLine = '';
    let zeroLine = '';
    for (const itemId of itemIds) {
      const itemName = await redis.get(`${arena}:item:${itemId}:name`);
      const strength = Number(await redis.hget(`${arena}:item:${itemId}:stats`, 'STR'));
      const skillCheck = randomInt(20) + 1;
      if (skillCheck === 20) {
        exponent += 2;
        outcome.push(`+ 2 ${itemName} nat 20`);
        anySuccess = true;
      } else if (skillCheck === 1) {
        exponent -= 1;
        outcome.push(`- 1 ${itemName} crit fail`);
      } else if (skillCheck + strength >= difficulty) {
        exponent += 1;
        const add = plusLine ? ` +1 ${itemName}` : `+ 1 ${itemName}`;
        // should we wrap?
        if (plusLine.length + add.length > LINE_LENGTH) {
          outcome.push(plusLine);
          plusLine = `+ 1 ${itemName}`;
        } else {
          plusLine += add;
        }
        anySuccess = true;
      } else {
        const zero = zeroLine ? ` 0 ${itemName}` : `  0 ${itemName}`;
        if (zeroLine.length + zero.length > LINE_LENGTH) {
          outcome.push(zeroLine);
          zeroLine = `  0 ${itemName}`;
        } else {
          zeroLine += zero;
        }
      }
    }
    // flush any half-open lines
    if (plusLine) {
      outcome.push(plusLine);
      plusLine = '';
    }
    if (zeroLine) {
      outcome.push(zeroLine);
      zeroLine = '';
    }
    // did we pass any difficulty checks?
    if (anySuccess) {
      exponent = Math.max(0, exponent);
      const multiplier = BigInt(2) ** BigInt(exponent);
      outcome.push(`+ 2^${exponent} = ${multiplier.toLocaleString()}x`);
      totalAward *= multiplier;
    } else {
      outcome.push(`- multiplier failed`);
    }
    outcome.push(`+ total bonus ${totalAward.toLocaleString()}`);
  }

  const oldScore = BigInt(await redis.hget(`${arena}:scores`, playerId));
  const newScore = oldScore + BigInt(totalAward);
  outcome.push(`  score ${newScore.toLocaleString()}`);

  await redis.hset(`${arena}:scores`, playerId, newScore.toString());
  await updateHighScore(arena, playerId, newScore);
  await interaction.reply('```diff\n' + outcome.join('\n') + '\n```');
}
