import type { SlashCommandBuilder } from "@discordjs/builders";
import type { CommandInteraction, Interaction, InteractionReplyOptions, MessagePayload } from 'discord.js';

export interface Command {
  data: SlashCommandBuilder,
  execute: (_: CommandInteraction) => Promise<void>,
}

// typeof `interaction.reply`
export type Reply = (options: string | MessagePayload | InteractionReplyOptions) => Promise<void>;

export type Arena = string;
export type PlayerId = string;
export type ItemId = string;

export function lookupArena(interaction: Interaction): Arena {
  // TODO: generate a new arena per discord server
  // until then, limit ourself to one discord server
  if (interaction.guildId !== process.env.DISCORD_GUILD_ID) {
    throw new Error("This discord server does not have an active game, sorry!");
  }
  // GAME TWO
  return 'arena:2';
}

export async function lookupPlayerId(arena: Arena, interaction: Interaction): Promise<PlayerId> {
  const { redis } = global as any;
  const playerId = await redis.hget(`${arena}:discord_users`, interaction.user.id);
  if (!playerId) {
    throw new Error('Not playing; please /jointhegame first');
  }
  return playerId;
}
