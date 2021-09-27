import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { ItemId, lookupArena, lookupPlayerId } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Check your items.');

data.addBooleanOption(option =>
  option.setName('public')
    .setDescription('Flex?')
    .setRequired(false)
);

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);

  const ephemeral = !interaction.options.getBoolean('public');
  const inventory = `${arena}:inventory:${playerId}`;
  const itemIds: ItemId[] = await redis.smembers(inventory);
  if (!itemIds.length) {
    await interaction.reply({ content: 'Empty inventory.', ephemeral: true });
    return;
  }

  // scan their inventory
  const descs = await Promise.all(itemIds.map(async (itemId: ItemId) => {
    const itemName = await redis.get(`${arena}:item:${itemId}:name`);
    const itemType = await redis.get(`${arena}:item:${itemId}:type`);
    const strength = await redis.hget(`${arena}:item:${itemId}:stats`, 'STR');
    return `${itemType} named ${itemName}: STR ${strength}`;
  }));

  const content = '```\n' + descs.join('\n') + '\n```';
  await interaction.reply({ content, ephemeral });
}
