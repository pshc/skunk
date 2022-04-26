import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { Redis, lookupArena } from '../api';
import { Sorry } from '../utils';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('leavethegame')
    .setDescription('Deletes your dice blitz account.');

data.addStringOption(option => option.setName('yesimeanit').setDescription('Type "yesimeanit" here to confirm.').setRequired(true));

export async function execute(interaction: CommandInteraction) {
  const redis: Redis = (global as any).redis;
  const arena = lookupArena(interaction);
  const { user } = interaction;
  if (interaction.options.getString('yesimeanit') !== 'yesimeanit') {
    throw new Sorry("Are you sure?");
  }

  // does the discord user have an associated player?
  const playerId = await redis.HGET(`${arena}:discord_users`, user.id);
  if (playerId === undefined) {
    throw new Sorry("You don't have an account.");
  }

  // okay, try to remove them
  await interaction.deferReply();
  try {
    const playerName = await redis.HGET(`${arena}:names`, playerId);
    console.log(`"${playerName}" (${user.id}) is quitting.`);
    const tx = redis.multi();
    tx.HDEL(`${arena}:discord_users`, user.id);
    tx.HDEL(`${arena}:mentions`, playerId);
    tx.HDEL(`${arena}:names`, playerId);
    if (playerName) {
      tx.HDEL(`${arena}:name_lookup`, playerName.toLowerCase());
    }
    tx.HDEL(`${arena}:scores`, playerId);
    // abandon all their items
    const inventory = `${arena}:inventory:${playerId}`;
    const shelter = `${arena}:abandoned_items`;
    tx.SUNIONSTORE(shelter, [shelter, inventory]);
    tx.DEL(inventory);

    await tx.exec();
    await interaction.editReply(`**${playerName}** has quit the game!`);
  } catch (e) {
    console.error(e)
    await interaction.editReply("Error leaving!");
    return;
  }
}
