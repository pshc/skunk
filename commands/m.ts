import { SlashCommandBuilder, SlashCommandStringOption } from '@discordjs/builders';
import type { CommandInteraction as Inter } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';
import {
  Direction, Entity, World,
  SPAWN,
  addDirection, lookAtRoom, posToStr, position, roomAtPos, sanify,
} from '../mud';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('m')
  .setDescription('Multi-User Dungeon');

data.addSubcommandGroup(group => {
  group.setName("command").setDescription("Command")
  group.addSubcommand(cmd =>
    cmd.setName("look").setDescription("Describe your current location")
  );
  group.addSubcommand(cmd =>
    cmd.setName("go").setDescription("Move in a direction")
      .addStringOption(cardinalDirections)
  );
  group.addSubcommand(cmd =>
    cmd.setName("dig").setDescription("Carve a new exit")
      .addStringOption(cardinalDirections)
  );
  group.addSubcommand(cmd =>
    cmd.setName("describe").setDescription("Change this room's description")
      .addStringOption(opt =>
        opt.setName("text").setDescription("<description here>").setRequired(true)
      )
  );
  group.addSubcommand(cmd =>
    cmd.setName("respawn").setDescription("Return to the start room")
  );
  return group;
});

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
  // player entities are 'p' + player ID number
  const player = 'p' + await lookupPlayerId(arena, interaction);
  // TODO look up world ID using guild ID or arena data
  const world = 'world:1';
  // check if the world exists yet
  if (!await redis.exists(`${world}:rooms:ctr`)) {
    await setupWorld(world);
  }

  // dispatch to the correct handler below
  const command = CMD.get(interaction.options.getString('command'));
  if (!command) {
    throw new Error('Command handler missing!');
  }
  const content = await command(world, player, interaction);
  if (content) {
    interaction.reply({ content, ephemeral: true });
  }
}

async function setupWorld(world: World) {
  const { redis } = global as any;
  const spawnRoom = 'r' + await redis.incr(`${world}:rooms:ctr`);
  console.log(`Setting up ${world} with spawn ${spawnRoom}`);
  const tx = redis.multi();
  tx.sadd(`${world}:rooms`, spawnRoom);
  tx.hset(`${world}:rooms:by:pos`, SPAWN, spawnRoom);
  tx.hset(`${world}:description`, spawnRoom, 'This is the spawn room.');
  await tx.exec();
}

CMD.set('look', (world: World, player: Entity, _: Inter) => look(world, player));

export async function look(world: World, player: Entity): Promise<string> {
  const pos = await position(world, player);
  // fetch the room entity associated with this position
  const room = await roomAtPos(world, pos);
  if (!room) {
    return 'You have clipped through the world!';
  }
  return lookAtRoom(world, room, pos);
}

CMD.set('go', (world: World, player: Entity, interaction: Inter) => {
  const direction: Direction = interaction.options.getString('direction') as any;
  return go(world, player, direction);
});

export async function go(world: World, player: Entity, direction: Direction): Promise<string> {
  const { redis } = global as any;
  const pos = await position(world, player);
  const newPos = addDirection(pos, direction);
  const newRoom = await redis.hget(`${world}:rooms:by:pos`, newPos);
  if (!newRoom) {
    if (direction === 'u') {
      return 'There is no way up from here!';
    } else if (direction === 'd') {
      return 'There is no way down from here!';
    } else {
      return 'You bump into a wall!';
    }
  }
  await redis.hset(`${world}:pos`, player, newRoom);
  return lookAtRoom(world, newRoom, newPos);
}

CMD.set('dig', (world: World, player: Entity, interaction: Inter) => {
  const direction: Direction = interaction.options.getString('direction') as any;
  return dig(world, player, direction);
});

export async function dig(world: World, player: Entity, direction: Direction): Promise<string> {
  const { redis } = global as any;
  // this part is the same as `go`
  const pos = await position(world, player);
  const dugPos = addDirection(pos, direction);
  const existing = await redis.hget(`${world}:rooms:by:pos`, posToStr(dugPos));
  // okay, if it already exists just go there
  if (existing) {
    await redis.hset(`${world}:pos`, player, existing);
    return lookAtRoom(world, existing, dugPos);
  }
  // otherwise, carve it out
  const dugRoom = 'r' + await redis.incr(`${world}:rooms:ctr`);
  await redis.hset(`${world}:rooms:by:pos`, posToStr(dugPos), dugRoom);
}

CMD.set('describe', (world: World, player: Entity, interaction: Inter) => {
  const text = interaction.options.getString('text');
  return describe(world, player, text);
});

export async function describe(world: World, player: Entity, rawDescription: string): Promise<string> {
  const { redis } = global as any;
  const pos = await position(world, player);
  const room = await roomAtPos(world, pos);
  if (!room) {
    return `You are floating outside the world! (${pos})`;
  }
  const text = sanify(rawDescription);
  if (text) {
    await redis.hset(`${world}:description`, room, text);
    return 'Room description altered.';
  } else {
    return 'Please provide valid text!';
  }
}

CMD.set('respawn', (world: World, player: Entity, _: Inter) => respawn(world, player));

export async function respawn(world: World, player: Entity): Promise<string> {
  const { redis } = global as any;
  await redis.hset(`${world}:pos`, player, SPAWN);
  return "Returned to spawn!";
}
