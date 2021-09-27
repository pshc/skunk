import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Either double your points or lose them all!');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);

  // prevent spam
  const cooldownKey = `${arena}:roulette_cooldown:${playerId}`;
  const didSet = await redis.set(cooldownKey, '1', 'NX', 'EX', '3');
  if (didSet !== 'OK') {
    const ttl = await redis.ttl(cooldownKey);
    await interaction.reply({ content: `Roulette on cooldown for ${ttl}sec.`, ephemeral: true });
    return;
  }

  const revolver = `${arena}:revolver`;
  const reload = async () => {
    await redis.set(revolver, randomInt(6));
  };

  // make sure there is a bullet in the chamber
  if (!await redis.exists(revolver)) {
    await reload();
    await interaction.reply(`You load and spin the revolver.`);
    return;
  }

  // schut
  const blanksLeft = await redis.decr(revolver);
  if (Number(blanksLeft) < 0) {
    // RIP
    await reload();
    await redis.hset(`${arena}:scores`, playerId, '100');
    await interaction.reply(`**BANG!**`);
    // put 'em on death cooldown
    await redis.set(cooldownKey, '1', 'EX', '30');
  } else {
    // double your money
    const oldScore = BigInt(await redis.hget(`${arena}:scores`, playerId));
    const newScore = oldScore * BigInt(2);
    await redis.hset(`${arena}:scores`, playerId, newScore.toString());
    await interaction.reply(`_click_. Your score is now ${newScore}.`);
  }
}
