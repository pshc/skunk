import test from 'ava'
import { SnowflakeUtil } from 'discord.js';
import { joinTheGame } from '../commands/jointhegame';
import { roll } from '../commands/roll';
import type { Reply } from '../api';

const userId = () => SnowflakeUtil.generate();

// note, this conflicts with ava's parallel tests, since we use the global object...
test.before('mock redis', () => {
  (global as any).redis = require('async-redis-mock').createClient();
});

test('can roll 100', async (t) => {
  const arena = 'test100';
  const reply: Reply = async (msg) => console.log(msg);
  const a = await joinTheGame(arena, userId(), 'Anna', reply);
  const b = await joinTheGame(arena, userId(), 'Bob', reply);
  // roll till we get 100
  for (let i = 0; i < 1000; i++) {
    if ((await roll(arena, a, reply))[0] == 100) {
      t.assert(true);
      return;
    }
    if ((await roll(arena, b, reply))[0] == 100) {
      t.assert(true);
      return;
    }
  }
  t.assert(false, 'never rolled 100');
});
