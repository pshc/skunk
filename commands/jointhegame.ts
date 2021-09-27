import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena } from '../api';

const INITIAL_SCORE = 100;

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('jointhegame')
    .setDescription('Join the communal dice blitz!');

data.addStringOption((option) => option.setName('name').setDescription('Your in-game name.').setRequired(false));

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const { member, options, user } = interaction;

  let playerName = options.getString('name') || (member as any).nickname || user.username;
  playerName = playerName.replace(/[^\w ,'-]/g, '').trim().slice(0, 30);
  if (!playerName) {
    await interaction.reply({ content: "Please provide a valid name.", ephemeral: true });
    return;
  }

  // is the player in yet?
  const existingId: string = await redis.hget(`${arena}:discord_users`, user.id);
  if (Number(existingId) > 0) {
    await interaction.reply({ content: "You're already in!", ephemeral: true });
    return;
  }

  // okay, try to add them
  await interaction.deferReply();
  try {
    console.log(`"${playerName}" (${user.id}) is joining the game.`);
    const playerId = await redis.incr(`${arena}:player_count`);
    const tx = redis.multi();
    tx.hset(`${arena}:discord_users`, user.id, playerId);
    tx.hset(`${arena}:names`, playerId, playerName);
    tx.hset(`${arena}:scores`, playerId, INITIAL_SCORE);
    await tx.exec();
    await interaction.editReply(`Welcome to the game, **${playerName}**!`);
  } catch (e) {
    console.error(e);
    await interaction.editReply("Error joining!");
    return;
  }
}
