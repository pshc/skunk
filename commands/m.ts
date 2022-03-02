import { SlashCommandBuilder, SlashCommandStringOption } from '@discordjs/builders';
import type { CommandInteraction as Inter } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';
import type { Entity, World } from '../mud';
import { createPlayer } from '../mud/players';
import { Direction, setupWorld } from '../mud/spatial';
import {
  describe, dig, go, look, respawn,
} from '../mud/actions';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('m')
  .setDescription('Multi-User Dungeon');

data.addSubcommand(cmd =>
  cmd.setName("look").setDescription("Describe your current location")
);
data.addSubcommand(cmd =>
  cmd.setName("go").setDescription("Move in a direction")
    .addStringOption(cardinalDirections)
);
data.addSubcommand(cmd =>
  cmd.setName("dig").setDescription("Carve a new exit")
    .addStringOption(cardinalDirections)
);
data.addSubcommand(cmd =>
  cmd.setName("describe").setDescription("Change this room's description")
    .addStringOption(opt =>
      opt.setName("text").setDescription("<description here>").setRequired(true)
    )
);
data.addSubcommand(cmd =>
  cmd.setName("respawn").setDescription("Return to the start room")
);

function cardinalDirections(dir: SlashCommandStringOption): SlashCommandStringOption {
  dir.setName("direction").setDescription("Direction").setRequired(true)
    .addChoice("north", "n").addChoice("south", "s").addChoice("east", "e")
    .addChoice("west", "w").addChoice("up", "u").addChoice("down", "d");
  return dir;
}

const CMD: Map<string, (a: World, p: Entity, i: Inter) => Promise<string>> = new Map();

export async function execute(interaction: Inter) {
  const { redis } = global as any;
  // ensure they're actually playing
  const arena = lookupArena(interaction);
  // TODO look up world ID using guild ID or arena data
  const world = 'world:1';
  // check if the world exists yet
  if (!await redis.exists(`${world}:rooms:ctr`)) {
    await setupWorld(world);
  }
  // check if this player has an entity yet
  const playerArenaId = await lookupPlayerId(arena, interaction);
  let player: Entity = await redis.hget(`${arena}:mud:players`, playerArenaId);
  if (!player) {
    player = await createPlayer(arena, world, playerArenaId);
  }

  // dispatch to the correct handler below
  const command = CMD.get(interaction.options.getSubcommand(true));
  if (!command) {
    throw new Error('Command handler missing!');
  }
  const content = await command(world, player, interaction);
  if (content) {
    interaction.reply({ content, ephemeral: true });
  }
}

CMD.set('look', (world: World, player: Entity, _: Inter) => look(world, player));

CMD.set('go', (world: World, player: Entity, interaction: Inter) => {
  const direction: Direction = interaction.options.getString('direction') as any;
  return go(world, player, direction);
});

CMD.set('dig', (world: World, player: Entity, interaction: Inter) => {
  const direction: Direction = interaction.options.getString('direction') as any;
  return dig(world, player, direction);
});

CMD.set('describe', (world: World, player: Entity, interaction: Inter) => {
  const text = interaction.options.getString('text') || '';
  return describe(world, player, text);
});

CMD.set('respawn', (world: World, player: Entity, _: Inter) => respawn(world, player));
