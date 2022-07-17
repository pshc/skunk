import test from 'ava'
import { SnowflakeUtil } from 'discord.js';
import { joinTheGame } from '../commands/jointhegame';
import { roll, spirit } from '../commands/roll';
import type { Reply } from '../api';
import { redis } from '#burrow/db';

const userId = () => SnowflakeUtil.generate();

test.before('integrate redis', cleanUpTestRedis);

if (process.env.CI !== 'true') {
  test.after('clean up redis', async () => {
    await cleanUpTestRedis();
    await redis.quit();
  });
}

const TEST_ARENA = 'test';

async function cleanUpTestRedis() {
  const keys = await redis.keys(`${TEST_ARENA}:*`); // slow method
  await Promise.all(keys.map((key: string) => redis.del(key)));
}

test('can roll 1d100 max roll', async (t) => {
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
  // quick check if we can roll 2d100
  let two = await roll(arena, a, reply);
  t.is(two.length, 2, "trying to roll a 2d100");
  // roll quite a bit more...
  /*
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
  */
});

test('can cheer for combos', async (t) => {
  t.is(spirit([1]), '');
  t.is(spirit([2, 3]), '');
  t.assert(spirit([4, 4]).includes('DOUBLES'));
  t.assert(spirit([6, 1, 6]).includes('DOUBLES'));
  t.assert(spirit([99, 3, 6, 99]).includes('DOUBLES'));
  t.assert(spirit([5, 5, 5]).includes('TRIPLES'));
  t.assert(spirit([5, 5, 2, 5]).includes('TRIPLES'));
  // the funny number is awkward to test due to randomized responses... mock random?
  t.assert(spirit([2, 69]).includes('('));
  t.assert(spirit([69, 99]).includes('('));
  t.assert(spirit([10, 59]).includes('('));
  t.assert(spirit([3, 4, 69]).includes('('));
  t.assert(spirit([3, 7, 59]).includes('('));
  t.assert(spirit([1, 1]).includes('OOF'));
  t.assert(spirit([1, 1, 1]).includes('OOF'));
  t.assert(spirit([1, 1, 1, 1]).includes('OOF'));
  t.assert(spirit([1, 100]).includes('KARMA'));
  t.assert(spirit([100, 1]).includes('KARMA'));
  t.assert(spirit([100, 1, 100]).includes('KARMA'));
  t.assert(spirit([100, 100, 1]).includes('KARMA'));
  t.assert(spirit([100, 100, 100, 1]).includes('KARMA'));
  t.assert(spirit([2, 100]).includes('100'));
  t.assert(spirit([1, 2, 100]).includes('100'));
  t.assert(spirit([3, 100, 50, 4]).includes('100'));
  t.assert(spirit([1, 2]).includes('('));
  t.assert(spirit([1, 3, 5]).includes('('));
  t.assert(spirit([1, 8, 12, 98]).includes('('));
  t.assert(spirit([1, 110]).includes('🌠'));
  t.assert(spirit([1, 10, 100]).includes('🌠'));
  const tooNice = ['ʕ◉ᴥ◉ʔ', '(so nice they rolled it twice!)'];
  t.assert(tooNice.includes(spirit([69, 69])));
  t.assert(tooNice.includes(spirit([69, 69, 1])));
  t.assert(tooNice.includes(spirit([69, 2, 69])));
  t.assert(tooNice.includes(spirit([69, 69, 100])));
  t.assert(tooNice.includes(spirit([69, 4, 69, 8])));
});
