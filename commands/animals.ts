import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { ItemId, lookupArena, lookupPlayerId } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('animals')
    .setDescription('Survey the world.');

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  await lookupPlayerId(arena, interaction);

  const abandonedIds: ItemId[] = await redis.smembers(`${arena}:abandoned_items`);
  if (!abandonedIds.length) {
    await interaction.reply({ content: 'The streets are empty.', ephemeral: true });
    return;
  }

  // scan for abandoned animals
  const descs = await Promise.all(abandonedIds.map(async (itemId: ItemId) => {
    const itemName = await redis.get(`${arena}:item:${itemId}:name`);
    return itemName;
  }));

  await interaction.reply(`You see on the streets: ${descs.join(', ')}`);
}
