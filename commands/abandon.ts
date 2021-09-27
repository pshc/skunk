import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { ItemId, lookupArena, lookupPlayerId } from '../api';
import { sanifyName } from './jointhegame';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('abandon')
    .setDescription('Dispose of an item.');

data.addStringOption(option =>
  option.setName('name')
    .setDescription('Name of the item to abandon.')
    .setRequired(true)
);

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);

  const targetName = sanifyName(interaction.options.getString('name'));
  if (!targetName) {
    await interaction.reply({ content: 'Invalid name.', ephemeral: true });
    return;
  }
  const inventory = `${arena}:inventory:${playerId}`;
  const itemIds: ItemId[] = await redis.smembers(inventory);

  // scan their inventory for the item
  for (const itemId of itemIds) {
    const itemName = await redis.get(`${arena}:item:${itemId}:name`);
    if (itemName.toLowerCase() === targetName.toLowerCase()) {
        // found it!
        const tx = redis.multi();
        tx.srem(inventory, itemId);
        tx.sadd(`${arena}:abandoned_items`, itemId);
        await tx.exec();
        await interaction.reply(`Abandoned ${itemName} to the streets.`);
        return;
    }
  }

  const content = `Couldn't find "${targetName}", sorry!`;
  await interaction.reply({ content, ephemeral: true });
}
