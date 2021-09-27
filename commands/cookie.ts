import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena } from '../api';

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
  const didSet = await redis.set(cooldownKey, '1', 'NX', 'PX', '60000');
  if (didSet !== 'OK') {
    const ttl = await redis.ttl(cooldownKey);
    await interaction.reply({ content: `Cookie on cooldown for ${ttl}sec`, ephemeral: true });
    return;
  }

  // roll and add 'em
  const a = randomInt(6) + 1;
  const b = randomInt(6) + 1;
  const score = await redis.hincrby(`${arena}:scores`, playerId, a + b);
  await interaction.reply(`Rolled ${a} + ${b}. Your new score is ${score}.`);
}
