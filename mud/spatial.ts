import type { Entity, World } from '.';
import { sanify } from './input';

/// A 3D coordinate in space.
export type Pos = { x: number, y: number, z: number };
export const SPAWN = '0,0,0';

/// A cardinal direction or up/down.
export type Direction = 'n' | 's' | 'e' | 'w' | 'u' | 'd';
export const DIRECTIONS: Direction[] = ['n', 's', 'e', 'w', 'u', 'd'];

export async function setupWorld(world: World) {
  const { redis } = global as any;
  const spawnRoom = 'r' + await redis.incr(`${world}:rooms:ctr`);
  console.log(`Setting up ${world} with spawn ${spawnRoom}`);
  const tx = redis.multi();
  tx.sadd(`${world}:rooms`, spawnRoom);
  tx.hset(`${world}:pos`, spawnRoom, SPAWN);
  tx.hset(`${world}:rooms:by:pos`, SPAWN, spawnRoom);
  tx.hset(`${world}:description`, spawnRoom, 'This is the spawn room.');
  await tx.exec();
}

/// Converts a redis str to a 3D coordinate object.
export function strToPos(str: string): Pos {
  const match = /^(-?\d+),(-?\d+),(-?\d+)$/.exec(str);
  if (!match) {
    throw new Error(`Invalid pos \`${sanify(str)}\``);
  }
  return {x: Number(match[1]), y: Number(match[2]), z: Number(match[3])};
}

/// Converts a 3D coordinate to a redis str.
export function posToStr(pos: Pos): string {
  if (!('x' in pos) || !('y' in pos) || !('z' in pos)) {
    throw new Error(`Invalid Pos \`${sanify(pos.toString())}\``);
  }
  return `${pos.x},${pos.y},${pos.z}`;
}

/// Add a direction vector to a coordinate to yield a new coordinate.
export function addDirection(pos: Pos, direction: Direction): Pos {
  const { x, y, z } = pos;
  switch (direction) {
    case 'n': return { x, y: y - 1, z };
    case 's': return { x, y: y + 1, z };
    case 'e': return { x: x + 1, y, z };
    case 'w': return { x: x - 1, y, z };
    case 'u': return { x, y, z: z + 1 };
    case 'd': return { x, y, z: z - 1 };
    default: throw new Error(`Bad direction \`${sanify(direction)}\``);
  }
}

/// Returns the coordinates of a given entity.
export async function position(world: World, entity: Entity): Promise<Pos> {
  const { redis } = global as any;
  const pos: string = await redis.hget(`${world}:pos`, entity);
  return strToPos(pos || SPAWN)
}

/// Returns the entity of the room at `coordinates` (if any).
export async function roomAtPos(world: World, pos: Pos): Promise<Entity | void> {
  const { redis } = global as any;
  return await redis.hget(`${world}:rooms:by:pos`, posToStr(pos));
}

/// Returns the formatted description of room `room` at position `roomPos`.
export async function lookAtRoom(world: World, room: Entity, roomPos: Pos): Promise<string> {
  // TODO check that room & roomPos line up? tiny race condition tho
  const { redis } = global as any;

  // look up the description by entity
  const desc = await redis.hget(`${world}:description`, room);
  const youSee = desc ? 'You see:\n`' + desc + '`' : 'You see a non-descript space.';

  // compute exits the slow way - by checking all adjacent coordinates
  const allExits = await Promise.all(DIRECTIONS.map(async (dir: Direction) => {
    const exitPos = addDirection(roomPos, dir);
    const exitRoom = await redis.hget(`${world}:rooms:by:pos`, posToStr(exitPos));
    return exitRoom ? dir : null;
  }));

  const validExits: Direction[] = allExits.filter(dir => !!dir);
  if (validExits.length > 0) {
    const exitsDesc = 'Exits: ' + validExits.map(dir => dir.toUpperCase()).join(', ');
    return youSee + '\n' + exitsDesc;
  } else {
    return youSee;
  }
}
