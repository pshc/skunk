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
  playerName = sanifyName(playerName);
  if (!playerName) {
    await interaction.reply({ content: "Please provide a valid name.", ephemeral: true });
    return;
  }

  // is the player in yet?
  const existingId: string | null = await redis.hget(`${arena}:discord_users`, user.id);
  if (Number(existingId) > 0) {
    await interaction.reply({ content: "You're already in!", ephemeral: true });
    return;
  }

  // is the name taken?
  const existingOwner: string | null = await redis.hget(`${arena}:name_lookup`, playerName.toLowerCase());
  if (Number(existingOwner) > 0) {
    await interaction.reply({ content: "Name already taken; please select another.", ephemeral: true });
    return;
  }

  // okay, try to add them
  await interaction.deferReply();
  try {
    console.log(`"${playerName}" (${user.id}) is joining the game.`);
    const playerId = await redis.incr(`${arena}:player_count`);
    const tx = redis.multi();
    // TODO we should really use WATCH to fail properly on conflict
    tx.hsetnx(`${arena}:discord_users`, user.id, playerId);
    tx.hsetnx(`${arena}:names`, playerId, playerName);
    tx.hsetnx(`${arena}:name_lookup`, playerName.toLowerCase(), playerId);
    tx.hsetnx(`${arena}:scores`, playerId, INITIAL_SCORE);
    await tx.exec();
    await interaction.editReply(`Welcome to the game, **${playerName}**!`);
  } catch (e) {
    console.error(e);
    await interaction.editReply("Error joining!");
    return;
  }
}

export function sanifyName(name: string): string {
  return name.replace(/[^\w ,'-]/g, '').trim().slice(0, 30);
}
