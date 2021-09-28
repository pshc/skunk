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

  // count each players' pets
  const players = await redis.hgetall(`${arena}:names`);
  const petCounts: [string, number][] = [];
  for (const playerId in players) {
    const playerName = players[playerId];
    const inventorySize = Number(await redis.scard(`${arena}:inventory:${playerId}`));
    petCounts.push([playerName, inventorySize]);
  }
  petCounts.sort(([nameA, countA], [nameB, countB]) => countA - countB);
  const lines = petCounts.map(([name, count]) => `${name}: ${count}`);
  const playersDesc = '```\n' + lines.join('\n') + '\n```';

  // scan for abandoned animals
  const abandonedIds: ItemId[] = await redis.smembers(`${arena}:abandoned_items`);
  const descs = await Promise.all(abandonedIds.map(async (itemId: ItemId) => {
    const itemName = await redis.get(`${arena}:item:${itemId}:name`);
    return itemName;
  }));
  let streetDesc;
  if (abandonedIds.length) {
    streetDesc = `On the streets: ${descs.join(', ')}`;
  } else {
    streetDesc = 'The streets are empty.';
  }

  await interaction.reply(playersDesc + '\n' + streetDesc);
}
