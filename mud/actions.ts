import type { Entity, World } from '../mud';
import { sanify } from './input';
import {
  Direction,
  SPAWN,
  addDirection, lookAtRoom, posToStr, position, roomAtPos,
} from '../mud/spatial';

export async function look(world: World, player: Entity): Promise<string> {
  const pos = await position(world, player);
  // fetch the room entity associated with this position
  const room = await roomAtPos(world, pos);
  if (!room) {
    return 'You have clipped through the world!';
  }
  return lookAtRoom(world, room, pos);
}

export async function go(world: World, player: Entity, direction: Direction): Promise<string> {
  const { redis } = global as any;
  const pos = await position(world, player);
  const newPos = addDirection(pos, direction);
  const newRoom = await redis.hget(`${world}:rooms:by:pos`, posToStr(newPos));
  if (!newRoom) {
    if (direction === 'u') {
      return 'There is no way up from here!';
    } else if (direction === 'd') {
      return 'There is no way down from here!';
    } else {
      return 'You bump into a wall!';
    }
  }
  await redis.hset(`${world}:pos`, player, posToStr(newPos));
  return lookAtRoom(world, newRoom, newPos);
}

export async function dig(world: World, player: Entity, direction: Direction): Promise<string> {
  const { redis } = global as any;
  // this part is the same as `go`
  const pos = await position(world, player);
  const dugPos = addDirection(pos, direction);
  const existing = await redis.hget(`${world}:rooms:by:pos`, posToStr(dugPos));
  // okay, if it already exists just go there
  if (existing) {
    await redis.hset(`${world}:pos`, player, posToStr(dugPos));
    return lookAtRoom(world, existing, dugPos);
  }
  // otherwise, carve it out
  const dugRoom = 'r' + await redis.incr(`${world}:rooms:ctr`);
  const tx = redis.multi();
  tx.sadd(`${world}:rooms`, dugRoom);
  tx.hset(`${world}:pos`, dugRoom, posToStr(dugPos));
  tx.hset(`${world}:rooms:by:pos`, posToStr(dugPos), dugRoom);
  // and move into it
  tx.hset(`${world}:pos`, player, posToStr(dugPos));
  await tx.exec();
  return 'You carve out a new room!';
}


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

export async function respawn(world: World, player: Entity): Promise<string> {
  const { redis } = global as any;
  await redis.hset(`${world}:pos`, player, SPAWN);
  return "Returned to spawn!";
}
