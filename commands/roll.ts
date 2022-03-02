import { promises as fsAsync } from 'fs';
import { randomInt } from 'crypto';
import { SlashCommandBuilder } from '@discordjs/builders';
import type { CommandInteraction } from 'discord.js';
import { lookupArena, lookupPlayerId } from '../api';

export const data: SlashCommandBuilder = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Try for the max score on xd100.');

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
    redis.set(countKey, '1');
    diceCount = 1;
  }

  // Pooper is the last person to roll a 1
  // get the current pooper
  const pooperKey = `${arena}:maiden:pooper`;
  let latestPooper = await redis.get(pooperKey);

  // roll xd100
  const rolls: number[] = [];
  let sum = 0;
  let isMaxRoll = true;
  let isRolledOne = false;
  for (let i = 0; i < diceCount; i++) {
    const roll = randomInt(100) + 1;
    if (roll < 100) {
      isMaxRoll = false;
    }
    if (roll === 1) {
      isRolledOne = true;
      latestPooper = playerId;
      await redis.set(pooperKey, latestPooper);
    }
    rolls.push(roll);
    sum += roll;
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
  const yesterdayChamp = await redis.get(`${yesterday}:name`);
  const adorn = (name: string) => adornName({name, champ: yesterdayChamp, pooper: latestPooper});

  // announce result
  if (isMaxRoll) {
    await redis.incr(countKey); // increase target number of dice
    await interaction.reply(`${adorn(name)} MAX ROLL: \`${rolls}\` Result: ${sum}`);
    await redis.del(prevKey);
  } else {
    const spirit = diceCount === 2 ? ' ' + twoSpirit(rolls[0], rolls[1], sum) : '';
    const trend = newDailyHigh === 'higher' ? ' 📈' : newDailyHigh === 'new day' ? ' ☀️' : '';
    await interaction.reply(`${adorn(name)} Roll: \`${rolls}\` Result: ${sum}${spirit}${trend}`);
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

export const adornName = (params: {name: string, champ: string, pooper: string}) => {
  const {name, champ, pooper} = params;
  const badges = [name];
  if (!!champ && name === champ) {
    badges.push('👑');
  }
  if (!!pooper && name === pooper) {
    badges.push('💩');
  }

  return badges.join('');
};
