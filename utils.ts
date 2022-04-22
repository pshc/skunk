import { randomInt } from 'crypto';

export function chooseOne<T>(options: T[]): T {
  return options[randomInt(options.length)];
}
