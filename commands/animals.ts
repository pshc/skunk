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

  const itemIds: ItemId[] = await redis.smembers(`${arena}:abandoned_items`);
  if (!itemIds.length) {
    await interaction.reply({ content: 'The streets are empty.', ephemeral: true });
    return;
  }

  // scan their inventory
  const descs = await Promise.all(itemIds.map(async (itemId: ItemId) => {
    const itemName = await redis.get(`${arena}:item:${itemId}:name`);
    const itemType = await redis.get(`${arena}:item:${itemId}:type`);
    const strength = await redis.hget(`${arena}:item:${itemId}:stats`, 'STR');
    return `${itemType} "${itemName}" STR ${strength}`;
  }));

  await interaction.reply(`You see on the streets: ${descs.join(', ')}`);
}
