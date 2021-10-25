import type { Entity, World } from '.';
import { SPAWN } from './spatial';
import type { Arena, PlayerId } from '../api';

export async function createPlayer(arena: Arena, world: World, playerId: PlayerId): Promise<Entity> {
  const { redis } = global as any;
  const ctr = await redis.incr(`${world}:players:ctr`);
  const player = 'p' + ctr;
  const playerName = await redis.hget(`${arena}:names`, playerId);

  const tx = redis.multi();
  tx.hset(`${world}:players`, player, playerName || 'Anon');
  tx.hset(`${world}:pos`, player, SPAWN);
  // make sure we can look up this player next time
  tx.hset(`${arena}:mud:players`, playerId, player);
  await tx.exec();
  return player;
}
