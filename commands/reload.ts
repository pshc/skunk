import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Re-spin the revolver.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  // lookup player so that non-players can't (ab)use this command
  const playerId = await lookupPlayerId(arena, interaction);
  const names = await redis.hgetall(`${arena}:names`);
  const playerName = names[playerId];

  // manual reload means gun gets too hot for anyone to pick it up
  const cooldownKey = `${arena}:reload_cooldown`;
  const didSet = await redis.set(cooldownKey, '1', 'NX', 'EX', '60');
  if (didSet !== 'OK') {
    const ttl = await redis.ttl(cooldownKey);
    await interaction.reply({ content: `Manual reload on cooldown for ${ttl}sec.`, ephemeral: true });
    return;
  }

  // prevent this player from immediately using the gun
  await redis.set(`${arena}:roulette_cooldown:${playerId}`, '1', 'EX', '30');

  await reload(`${arena}:revolver`);
  await interaction.reply(`${playerName} loads and spins the revolver.`);
}

export async function reload(revolver: string) {
  const { redis } = global as any;
  await redis.set(revolver, randomInt(6));
  await redis.set(revolver + '_multiplier', '1');
}
