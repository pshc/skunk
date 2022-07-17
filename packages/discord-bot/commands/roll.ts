import { promises as fsAsync } from 'fs';
import { join as joinPath } from 'path';
import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import type { Arena, PlayerId, Reply } from '../api';
import { lookupArena, lookupPlayerId } from '../api';
import { redis } from '#burrow/db';
import { adornName, dailyTrendMarker, dayRollKey, increaseDoublerStreak, loadDoubler, multiply, saveNewDoubler } from '#burrow/dice';
import { Sorry, chooseOne } from '#burrow/utils';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Try for the max score on xd100.');

// set FAST_EMOJI in .env
const FAST_COOLDOWN = 3;

export async function execute(interaction: CommandInteraction) {
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);
  await roll(arena, playerId, msg => interaction.reply(msg));
}

export async function roll(arena: Arena, playerId: PlayerId, reply: Reply): Promise<number[]> {
  const name = (await redis.hget(`${arena}:names`, playerId)) || '???';

  // prevent consecutive rolls
  const prevKey = `${arena}:maiden:previous_roller`;
  const prevRoller = await redis.get(prevKey);
  if (prevRoller === playerId) {
    throw new Sorry('The dice are hot!');
  }

  // load the game state
  const countKey = `${arena}:maiden:dice_count`;
  let diceCount = Number(await redis.get(countKey));
  if (!diceCount || diceCount < 1) {
    await redis.set(countKey, '1');
    diceCount = 1;
  }

  // hundo is the last person to roll a 100
  const hundoKey = `${arena}:maiden:hundo`;
  let hundo = await redis.get(hundoKey) || '<nobody>';
  // add more sigils for consecutive 100s
  const hundoStreakKey = `${hundoKey}_streak`;
  let hundoStreak: number = Number(await redis.get(hundoStreakKey));

  // Pooper is the last person to roll a 1
  const pooperKey = `${arena}:maiden:pooper`;
  let pooper = await redis.get(pooperKey) || '<nobody>';
  // pooper streak
  const poopSuiteKey = `${pooperKey}_streak`;
  let poopSuite: number = Number(await redis.get(poopSuiteKey));

  // last person to roll doubles
  let doubler = await loadDoubler(arena);

  // roll xd100
  const rolls: number[] = [];
  let sum = 0;
  let isMaxRoll = true;
  for (let i = 0; i < diceCount; i++) {
    const roll = randomInt(100) + 1;
    if (roll < 100) {
      isMaxRoll = false;
    } else {
      if (name !== hundo) {
        hundo = name;
        hundoStreak = 1;
        await redis.set(hundoKey, hundo);
        await redis.set(hundoStreakKey, '1');
      } else {
        // track consecutive 100s rolled by the same player
        hundoStreak = Number(await redis.incr(hundoStreakKey));
      }
    }
    if (roll === 1) {
      if (name !== pooper) {
        pooper = name;
        poopSuite = 1;
        await redis.set(pooperKey, pooper);
        await redis.set(poopSuiteKey, '1');
      } else {
        // track consecutive ones rolled by the same player
        poopSuite = Number(await redis.incr(poopSuiteKey));
      }
    }
    rolls.push(roll);
    sum += roll;
  }

  if (!isMaxRoll && hasDuplicates(rolls, 2)) {
    if (name !== doubler.name) {
      doubler = await saveNewDoubler(arena, name);
    } else {
      // todo: bonus on triples?
      await increaseDoublerStreak(arena, doubler);
    }
  }

  let dailyTrend: undefined | 'new day' | 'higher' | 'lower';
  {
    // update daily records
    const today = dayRollKey(arena, 'today');
    const dailyHigh = Number(await redis.get(`${today}:score`));
    const dailyLow = Number(await redis.get(`${today}:low`));
    // expire these keys a month from now
    const expiry = 60 * 60 * 24 * 30;

    if (!dailyHigh || dailyHigh < sum) {
      const tx = redis.multi();
      tx.setex(`${today}:score`, expiry, sum);
      tx.setex(`${today}:name`, expiry, name);
      await tx.exec();
      dailyTrend = !!dailyHigh ? 'higher' : 'new day';
    }
    if (!dailyLow || dailyLow > sum) {
      const tx = redis.multi();
      tx.setex(`${today}:low`, expiry, sum);
      tx.setex(`${today}:low_name`, expiry, name);
      await tx.exec();
      if (!dailyTrend) {
        dailyTrend = 'lower';
      }
    }
  }

  // crown yesterday's high roller
  const yesterday = dayRollKey(arena, 'yesterday');
  const champ = await redis.get(`${yesterday}:name`) || '<nobody>';
  // award brick to yesterday's low roller
  const brick = await redis.get(`${yesterday}:low_name`) || '<nobody>';
  const adorn = (name: string) =>
    adornName({ name, champ, brick, hundo, hundoStreak, pooper, poopSuite, doubler });

  // track speedy rolling with an expiring key
  const speedKey = `${arena}:speed`;
  const speedRolling = Number(await redis.get(speedKey)) || 0;
  let tx = redis.multi();
  tx.incr(speedKey);
  tx.expire(speedKey, FAST_COOLDOWN);
  await tx.exec();

  // announce result
  if (isMaxRoll) {
    await redis.incr(countKey); // increase target number of dice
    await reply(`${adorn(name)} MAX ROLL: \`${rolls}\` Result: ${sum}`);
    await redis.del(prevKey);
  } else {
    const cheer = spirit(rolls);
    const trend = dailyTrendMarker(dailyTrend);
    const speed = speedRolling ? ` ${multiply(process.env.FAST_EMOJI || '💨', speedRolling)}` : '';

    await reply(`${adorn(name)} Roll: \`${rolls}\` Result: ${sum}${cheer ? ' ' + cheer : ''}${trend}${speed}`);
    // don't let them re-roll consecutively
    await redis.set(prevKey, playerId);
  }

  // statistics
  await Promise.all([
    (async () => {
      // update all-time high score
      const oldHighScore = Number(await redis.get(`${arena}:maiden:high_score`));
      if (!oldHighScore || oldHighScore < sum) {
        await redis.set(`${arena}:maiden:high_score`, sum);
        await redis.set(`${arena}:maiden:high_name`, name);
      }
    })(),
    (async () => {
      // update roll count
      await redis.hincrby(`${arena}:maiden:roll_counts`, playerId, 1);
    })(),
    (async () => {
      // record the roll
      const rollsDir = joinPath('..', '..', 'rolls');
      const csv = joinPath(rollsDir, `${arena}_${diceCount}d100.csv`);
      const now = new Date().toISOString();
      await fsAsync.appendFile(csv, `${rolls.join(',')},${now},${name}\n`);
    })(),
  ]);

  return rolls;
}

// Adds extra flavour to the roll result based on dice numbers.
// note: this is not used upon max roll
export function spirit(rolls: number[]): string {
  const n = rolls.length;
  const sum = rolls.reduce((a, b) => a + b);
  switch (true) {
    case n < 2:
      return '';
    case sum === n:
      return '(BIG OOOF)';
    case rolls.filter(a => a === 1 || a === 100).length === n:
      return 'HOW IS THIS EVEN POSSIBLE, WHY DO YOU HAVE THIS KARMA?!';
    case n > 2 && hasDuplicates(rolls, 3):
      return 'TRIPLES!!! :beers: :beers: :beers:';
    case rolls.filter(a => a === 69).length === 2:
      return chooseOne(['ʕ◉ᴥ◉ʔ', '(so nice they rolled it twice!)']);
    case hasDuplicates(rolls, 2):
      return 'DOUBLES! :beers:';
    case rolls.includes(69) || sum === 69:
      return chooseOne([
        '( ͝° ͜ʖ͡°)',
        '(nice)',
        '★~(◠‿◕✿)',
        '(⁄ ⁄•⁄ω⁄•⁄ ⁄)',
        '( ͡° ͜ʖ├┬┴┬┴',
        '(✌ﾟ∀ﾟ)☞',
      ]);
    case sum === 111:
      return '🌠';
    case rolls.includes(100):
      return '(another :100: wasted)';
    case rolls.includes(1):
      return chooseOne([
        '(oof)',
        '(you make me sad)',
        '(my gram rolls better than you)',
        `(you're number one!)`,
        '(git gud)',
      ]);
    default:
      return '';
  }
}

function hasDuplicates(rolls: number[], target: number): boolean {
  const freqMap = new Map<number, number>();
  for (const roll of rolls) {
    const n = (freqMap.get(roll) || 0) + 1;
    if (n >= target) {
      return true;
    }
    freqMap.set(roll, n);
  }
  return false;
}
