import test from 'ava'
import { SnowflakeUtil } from 'discord.js';
import Redis from 'ioredis';
import { joinTheGame } from '../commands/jointhegame';
import { roll } from '../commands/roll';
import type { Reply } from '../api';

const userId = () => SnowflakeUtil.generate();

// note, this conflicts with ava's parallel tests, since we use the global object...
test.before('integrate redis', async () => {
  (global as any).redis = new Redis();
  await cleanUpTestRedis();
});

if (process.env.CI !== 'true') {
  test.after('clean up redis', async () => {
    await cleanUpTestRedis();
    const redis: Redis = (global as any).redis;
    await redis.quit();
  });
}

const TEST_ARENA = 'test';

async function cleanUpTestRedis() {
  const redis: Redis = (global as any).redis;
  const keys = await redis.keys(`${TEST_ARENA}:*`); // slow method
  await Promise.all(keys.map((key: string) => redis.del(key)));
}

test('can roll max rolls', async (t) => {
  const arena = TEST_ARENA;
  const reply: Reply = async (msg) => console.log(msg);
  const a = await joinTheGame(arena, userId(), 'Anna', reply);
  const b = await joinTheGame(arena, userId(), 'Bob', reply);
  let maxRoll = false;
  // roll till we get 100
  for (let i = 0; i < 1000; i++) {
    if ((await roll(arena, a, reply))[0] == 100) {
      maxRoll = true;
      break;
    }
    if ((await roll(arena, b, reply))[0] == 100) {
      maxRoll = true;
      break;
    }
  }
  t.assert(maxRoll, 'never rolled 100');
  // roll quite a bit more...
  maxRoll = false;
  for (let i = 0; i < 100000; i++) {
    let [a1, a2] = await roll(arena, a, reply);
    if (a1 + a2 == 200) {
      maxRoll = true;
      break;
    }
    let [b1, b2] = await roll(arena, b, reply);
    if (b1 + b2 == 200) {
      maxRoll = true;
      break;
    }
  }
  t.assert(maxRoll, 'never rolled 200');
  // see if we can roll 3d100
  let three = await roll(arena, a, reply);
  t.assert(three.length === 3, "trying to roll 3d100");
});
