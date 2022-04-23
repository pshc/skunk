import { randomInt } from 'crypto';

export function chooseOne<T>(options: T[]): T {
  return options[randomInt(options.length)];
}

export function possessive(str: string): string {
  return str.endsWith('s') ? str + "'" : str + "'s";
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
