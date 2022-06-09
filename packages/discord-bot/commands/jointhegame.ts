import { strict as assert } from 'assert';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction, Snowflake } from 'discord.js';
import type { Arena, PlayerId, Reply } from '../api';
import { lookupArena } from '../api';
import { redis } from 'burrow/db';

const INITIAL_SCORE = 100;

export const data: SlashCommandBuilder = new SlashCommandBuilder()
    .setName('jointhegame')
    .setDescription('Join the communal dice blitz!');

data.addStringOption((option) => option.setName('name').setDescription('Your in-game name.').setRequired(false));

export async function execute(interaction: CommandInteraction) {
  const arena = lookupArena(interaction);
  const { member, options, user } = interaction;
  const playerName = options.getString('name') || (member as any).nickname || user.username;
  await joinTheGame(arena, user.id, playerName, msg => interaction.reply(msg));
}

export async function joinTheGame(arena: Arena, userId: Snowflake, playerName: string, reply: Reply): Promise<PlayerId> {
  playerName = sanifyName(playerName);
  assert(!!playerName, "Please provide a valid name.");

  // is the player in yet?
  const existingId: string | null = await redis.hget(`${arena}:discord_users`, userId);
  assert(!Number(existingId), "You're already in!");

  // is the name taken?
  const existingOwner: string | null = await redis.hget(`${arena}:name_lookup`, playerName.toLowerCase());
  assert(!Number(existingOwner), "Name already taken; please select another.");

  // okay, try to add them
  try {
    console.log(`"${playerName}" (${userId}) is joining the game.`);
    const playerId = String(await redis.incr(`${arena}:player_count`));
    const tx = redis.multi();
    // TODO we should really use WATCH to fail properly on conflict
    tx.hsetnx(`${arena}:discord_users`, userId, playerId);
    tx.hsetnx(`${arena}:mentions`, playerId, userId);
    tx.hsetnx(`${arena}:names`, playerId, playerName);
    tx.hsetnx(`${arena}:name_lookup`, playerName.toLowerCase(), playerId);
    tx.hsetnx(`${arena}:scores`, playerId, INITIAL_SCORE);
    await tx.exec();
    await reply(`Welcome to the game, **${playerName}**!`);
    return playerId;
  } catch (e) {
    await reply("Error joining!");
    throw e;
  }
}

export function sanifyName(name: string): string {
  return name.replace(/[^\w ,'-]/g, '').trim().slice(0, 30);
}
