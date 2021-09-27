import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { ItemId, lookupArena } from '../api';
import { updateHighScore } from './score';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('cookie')
    .setDescription('Click for a cookie.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await redis.hget(`${arena}:discord_users`, interaction.user.id);
  if (!playerId) {
    throw new Error('Not playing');
  }

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
  let outcome = `Rolled ${a} + ${b}.`;
  let totalAward = roll;

  // apply inventory bonuses
  const inventory = `${arena}:inventory:${playerId}`;
  const itemIds: ItemId[] = await redis.smembers(inventory);
  if (itemIds.length > 0) {
    // initial multiplier derived from difficulty class
    let exponent = randomInt(6);
    const difficulty = (exponent + 1) * 5;
    outcome += ` Bonus DC ${difficulty} adds +${exponent} multiplier.`;
    // each item has a chance to add to the multiplier
    let anySuccess = false;
    for (const itemId of itemIds) {
      const itemName = await redis.get(`${arena}:item:${itemId}:name`);
      const strength = Number(await redis.hget(`${arena}:item:${itemId}:stats`, 'STR'));
      const skillCheck = randomInt(20) + 1;
      if (skillCheck === 20) {
        exponent += 2;
        outcome += ` ${itemName} nat 20 +2!`;
        anySuccess = true;
      } else if (skillCheck === 1) {
        exponent -= 1;
        outcome += ` ${itemName} crit fail -1.`;
      } else if (skillCheck + strength >= difficulty) {
        exponent += 1;
        outcome += ` ${itemName} +1.`;
        anySuccess = true;
      } else {
        outcome += ` ${itemName} 0.`;
      }
    }
    // did we pass any difficulty checks?
    if (anySuccess) {
      exponent = Math.max(0, exponent);
      const multiplier = BigInt(2) ** BigInt(exponent);
      outcome += ` Multiplier 2^${exponent} = ${multiplier.toLocaleString()}.`;
      totalAward *= multiplier;
    } else {
      outcome += ` Multiplier failed.`;
    }
    outcome += ` Total **${totalAward.toLocaleString()}**.`;
  }

  const oldScore = BigInt(await redis.hget(`${arena}:scores`, playerId));
  const newScore = oldScore + BigInt(totalAward);
  outcome += ` Your new score is ${newScore.toLocaleString()}.`;

  await redis.hset(`${arena}:scores`, playerId, newScore.toString());
  await updateHighScore(arena, playerId, newScore);
  await interaction.reply(outcome);
}
