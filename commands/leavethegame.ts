import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('leavethegame')
    .setDescription('Deletes your dice blitz account.');

data.addStringOption(option => option.setName('yesimeanit').setDescription('Type "yesimeanit" here to confirm.').setRequired(true));

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const { user } = interaction;
  if (interaction.options.getString('yesimeanit') !== 'yesimeanit') {
    await interaction.reply({ content: "Are you sure?", ephemeral: true });
    return;
  }

  // does the discord user have an associated player?
  const playerId = await redis.hget(`${arena}:discord_users`, user.id);
  if (!Number(playerId)) {
    await interaction.reply({ content: "You don't have an account.", ephemeral: true });
    return;
  }

  // okay, try to remove them
  await interaction.deferReply();
  try {
    const playerName = await redis.hget(`${arena}:names`, playerId);
    console.log(`"${playerName}" (${user.id}) is quitting.`);
    const tx = await redis.multi();
    tx.hdel(`${arena}:discord_users`, user.id, playerId);
    tx.hdel(`${arena}:names`, playerId);
    tx.hdel(`${arena}:name_lookup`, playerName.toLowerCase());
    tx.hdel(`${arena}:scores`, playerId);
    // abandon all their items
    const inventory = `${arena}:inventory:${playerId}`;
    const shelter = `${arena}:abandoned_items`;
    tx.sunionstore(shelter, shelter, inventory);
    tx.del(inventory);

    await tx.exec();
    await interaction.editReply(`**${playerName}** has quit the game!`);
  } catch (e) {
    console.error(e)
    await interaction.editReply("Error leaving!");
    return;
  }
}
