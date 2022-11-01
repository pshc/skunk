import { redis } from './db';
import { chooseOne } from './utils';

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
  brick: string;
  hundo: string;
  hundoStreak: number;
  pooper: string;
  poopSuite: number;
  doubler: Doubler;
}

export const adornName = (params: AdornParams) => {
  const { name, champ, brick, hundo, hundoStreak, pooper, poopSuite, doubler } = params;
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
  if (!!brick && name === brick) {
    badges.push('🧱');
  }

  return badges.join('');
};

export function multiply(str: string, n: number): string {
  if (n === 69) return `${str} ×69 (nice)`;
  return n < 20 ? str.repeat(n) : `${str} ×${n}`;
}

const DOUBLES = ['🍒', '✌️', '🫁', '👯', '🤼', '🫂', '🎎', '🙌', '🖇️', '⚔️', '🛠️', '⛓️', '🛍️', '🚻', '👣', '🧦', '🩰', '⚖️', '🧬', '🎵', '♊', '🪺'];

// state for the current doubles-roller
interface Doubler {
  name: string;
  streak: number;
  token: string;
}

export async function loadDoubler(arena: string): Promise<Doubler> {
  const doublerKey = `${arena}:maiden:doubler`;
  const streakKey = `${doublerKey}_streak`;
  const tokenKey = `${doublerKey}_token`;

  const name = await redis.get(doublerKey) || '<nobody>';
  const streak = Number(await redis.get(streakKey));
  const token = await redis.get(tokenKey) || '✌️';
  return { name, streak, token };
}

export async function saveNewDoubler(arena: string, name: string): Promise<Doubler> {
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

export async function increaseDoublerStreak(arena: string, doubler: Doubler) {
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
    if (day <= 7) return '🌊';
    if (day <= 14) return '🏄';
    if (day <= 21) return '🏝️';
    return '🪸';
  } else if (month == 7) {
    if (day == 1) return '🍁';
    if (day <= 7) return '🐚';
    if (day <= 14) return '🦐';
    if (day <= 21) return '🦩';
    return '🌻';
  } else if (month == 8) {
    if (day <= 7) return '🦗';
    if (day <= 14) return '🦀';
    if (day <= 21) return '🦎';
    return '🦥';
  }
  else if (month == 9) {
    if (day <= 7) return '🦫';
    if (day <= 14) return '🦢';
    if (day <= 21) return '🐢';
    return '🐖';
  }
  else if (month == 10) {
    if (day <= 7) return '🦉';
    if (day <= 14) return '🐺';
    if (day <= 21) return '🦇';
    if (day <= 30) return '🎃';
    return '👻';
  }
  else if (month == 11) {
    if (day <= 7) return '🐀';
    if (day <= 14) return '🦔';
    if (day <= 21) return '🐏';
    return '🦬';
  }
  // TBD...
  if (month == 12 && day > 25) {
    return '🥚';
  }
  return '⛺';
}

export function dailyTrendMarker(daily: 'new day' | 'higher' | 'lower' | undefined): string {
  switch (daily) {
    case 'new day': return ' ☀️';
    case 'higher': return ' 📈';
    case 'lower': return ' 📉';
    default: return '';
  }
}
