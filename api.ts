import type { SlashCommandBuilder } from "@discordjs/builders";
import type { CommandInteraction } from 'discord.js';

export interface Command {
  data: SlashCommandBuilder,
  execute: (_: CommandInteraction) => Promise<void>,
}

export type Arena = string;
export type PlayerId = string;

export function lookupArena(interaction: CommandInteraction): Arena {
  // TODO: generate a new arena per discord server
  // until then, limit ourself to one discord server
  if (interaction.guildId !== process.env.DISCORD_GUILD_ID) {
    throw new Error("This discord server does not have an active game, sorry!");
  }
  return 'arena:1';
}
