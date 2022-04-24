import { randomInt } from 'crypto';

/// throwing this is like asserting but it won't be logged
export class Sorry extends Error {
}

export function chooseOne<T>(options: T[]): T {
  return options[randomInt(options.length)];
}

export function possessive(str: string): string {
  return str.endsWith('s') ? str + "'" : str + "'s";
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
