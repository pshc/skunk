import { promises as fsAsync } from 'fs';
import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Try for the max score on xd100.');

const FAST_EMOJI = '<:sonic:951253135236669470>';
const FAST_COOLDOWN = 3;

export async function execute(interaction: CommandInteraction) {
  const { redis } = global as any;
  const arena = lookupArena(interaction);
  const playerId = await lookupPlayerId(arena, interaction);
  const name = (await redis.hget(`${arena}:names`, playerId)) || '???';

  // prevent consecutive rolls
  const prevKey = `${arena}:maiden:previous_roller`;
  const prevRoller = await redis.get(prevKey);
  if (prevRoller === playerId) {
    await interaction.reply({ content: 'The dice are hot!', ephemeral: true });
    return;
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
  let hundo = await redis.get(hundoKey);
  // add more sigils for consecutive 100s
  const hundoStreakKey = `${hundoKey}_streak`;
  let hundoStreak: number = Number(await redis.get(hundoStreakKey));

  // Pooper is the last person to roll a 1
  const pooperKey = `${arena}:maiden:pooper`;
  let latestPooper = await redis.get(pooperKey);
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
      if (name !== latestPooper) {
        latestPooper = name;
        poopSuite = 1;
        await redis.set(pooperKey, latestPooper);
        await redis.set(poopSuiteKey, '1');
      } else {
        // track consecutive ones rolled by the same player
        poopSuite = Number(await redis.incr(poopSuiteKey));
      }
    }
    rolls.push(roll);
    sum += roll;
  }

  // only handle 2d100 doubles for now
  if (!isMaxRoll && diceCount === 2 && rolls[0] === rolls[1]) {
    if (name !== doubler.name) {
      doubler = await saveNewDoubler(arena, name);
    } else {
      await increaseDoublerStreak(arena, doubler);
    }
  }

  let newDailyHigh: undefined | 'new day' | 'higher';
  {
    // update daily high score
    const today = dayRollKey(arena, 'today');
    const dailyHighScore = Number(await redis.get(`${today}:score`));
    if (!dailyHighScore || dailyHighScore < sum) {
      // expire these keys a month from now
      const expiry = 60 * 60 * 24 * 30;
      await redis.setex(`${today}:score`, expiry, sum);
      await redis.setex(`${today}:name`, expiry, name);
      newDailyHigh = !!dailyHighScore ? 'higher' : 'new day';
    }
  }

  // crown yesterday's high roller
  const yesterday = dayRollKey(arena, 'yesterday');
  const champ = await redis.get(`${yesterday}:name`);
  const adorn = (name: string) =>
    adornName({ name, champ, hundo, hundoStreak, pooper: latestPooper, poopSuite, doubler });

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
    await interaction.reply(`${adorn(name)} MAX ROLL: \`${rolls}\` Result: ${sum}`);
    await redis.del(prevKey);
  } else {
    const spirit = diceCount === 2 ? ' ' + twoSpirit(rolls[0], rolls[1], sum) : '';
    const trend = newDailyHigh === 'higher' ? ' 📈' : newDailyHigh === 'new day' ? ' ☀️' : '';
    const speed = speedRolling ? ` ${multiply(FAST_EMOJI, speedRolling)}` : '';

    await interaction.reply(`${adorn(name)} Roll: \`${rolls}\` Result: ${sum}${spirit}${trend}${speed}`);
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
      const csv = `rolls_${arena}_${diceCount}d100.csv`;
      const now = new Date().toISOString();
      await fsAsync.appendFile(csv, `${rolls.join(',')},${now},${name}\n`);
    })(),
  ]);
}

function chooseOne<T>(options: T[]): T {
  return options[randomInt(options.length)];
}
function twoSpirit(a: number, b: number, sum: number): string {
  switch (true) {
    case a === 69 && b === 69:
      return chooseOne(['ʕ◉ᴥ◉ʔ', '(so nice they rolled it twice!)']);
    case sum === 2:
      return '(BIG OOOF)';
    case a === b:
      return 'DOUBLES! :beers:';
    case a === 69 || b === 69 || sum === 69:
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
    case (a === 1 && b === 100) || (a === 100 && b === 1):
      return 'HOW IS THIS EVEN POSSIBLE, WHY DO YOU HAVE THIS KARMA?!';
    case a === 100 || b === 100:
      return '(another :100: wasted)';
    case a === 1 || b === 1:
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

export function dayRollKey(arena: string, day: 'today' | 'yesterday'): string {
  const when = new Date();
  if (day === 'yesterday') {
    when.setDate(when.getDate() - 1); // apparently this works
  }
  const year = when.getFullYear();
  const month = when.getMonth() + 1;
  const date = when.getDate();
  const leadZero = (n: number) => (n < 10 ? '0' : '');
  const fullDate = `${year}-${leadZero(month)}${month}-${leadZero(date)}${date}`;
  return `${arena}:maiden:day:${fullDate}`;
}

interface AdornParams {
  name: string;
  champ: string;
  hundo: string;
  hundoStreak: number;
  pooper: string;
  poopSuite: number;
  doubler: Doubler;
}

export const adornName = (params: AdornParams) => {
  const { name, champ, hundo, hundoStreak, pooper, poopSuite, doubler } = params;
  const badges = [name];
  if (!!champ && name === champ) {
    badges.push('👑');
  }
  if (!!hundo && name === hundo) {
    const token = seasonalToken();
    badges.push(multiply(token, hundoStreak));
  }
  if (!!pooper && name === pooper) {
    badges.push(multiply('💩', poopSuite));
  }
  if (!!doubler.name && name === doubler.name) {
    badges.push(multiply(doubler.token, doubler.streak));
  }

  return badges.join('');
};

function multiply(str: string, n: number): string {
  if (n === 69) return `${str} x69 (nice)`;
  return n < 20 ? str.repeat(n) : `${str} x${n}`;
}

const DOUBLES = ['🍒', '✌️', '🫁', '👯', '🤼', '🫂', '🎎', '🙌', '🖇️', '⚔️', '🛠️', '⛓️', '🛍️', '🚻', '👣', '🧦', '🩰', '⚖️', '🧬', '🎵', '♊'];

// state for the current doubles-roller
interface Doubler {
  name: string;
  streak: number;
  token: string;
}

export async function loadDoubler(arena: string): Promise<Doubler> {
  const { redis } = global as any;

  const doublerKey = `${arena}:maiden:doubler`;
  const streakKey = `${doublerKey}_streak`;
  const tokenKey = `${doublerKey}_token`;

  const name = await redis.get(doublerKey);
  const streak = Number(await redis.get(streakKey));
  const token = await redis.get(tokenKey);
  return { name, streak, token };
}

async function saveNewDoubler(arena: string, name: string): Promise<Doubler> {
  const { redis } = global as any;

  const doublerKey = `${arena}:maiden:doubler`;
  const streakKey = `${doublerKey}_streak`;
  const tokenKey = `${doublerKey}_token`;

  // each doubles streak is assigned a random emoji
  const token = chooseOne(DOUBLES);

  const tx = redis.multi();
  tx.set(doublerKey, name);
  tx.set(streakKey, '1');
  tx.set(tokenKey, token);
  await tx.exec();

  return { name, streak: 1, token };
}

async function increaseDoublerStreak(arena: string, doubler: Doubler) {
  const { redis } = global as any;
  const doublerKey = `${arena}:maiden:doubler`;
  const streakKey = `${doublerKey}_streak`;
  doubler.streak = Number(await redis.incr(streakKey));
}

function seasonalToken(): string {
  const today = new Date;
  const day = today.getDate();
  const month = today.getMonth() + 1;

  if (month == 1) {
    if (day <= 7) return '🐣';
    if (day <= 14) return '🐤';
    if (day <= 30) return '🐓';
    return '🍗';
  } else if (month == 2) {
    return day <= 14 ? '🍲' : '⛷️';
  } else if (month == 3 && day <= 23) {
    return '☕';
  } else if (month <= 4 && day <= 14) {
    return '🌸';
  } else if (month == 4) {
    // easter weekend 2022
    if (day <= 17) return '🐇';
    if (day == 18) return '🍫';
    if (day <= 25) return '🌱';
    return '🪴';
  } else if (month == 5) {
    if (day <= 7) return '🌳';
    if (day <= 14) return '🐛';
    if (day <= 21) return '🦋';
    return '🦆';
  } else if (month == 6) {
    if (day <= 15) return '🌊';
    return '🏝️';
  } else if (month == 7) {
    if (day == 1) return '🍁';
    return '🌻';
  } else if (month == 8) {
    return '🦗';
  }
  // TBD...
  if (month == 12 && day > 25) {
    return '🥚';
  }
  return '⛺';
}
