/// A 3D coordinate in space.
export type Pos = { x: number, y: number, z: number };
export const SPAWN = '0,0,0';

/// A cardinal direction or up/down.
export type Direction = 'n' | 's' | 'e' | 'w' | 'u' | 'd';
export const DIRECTIONS: Direction[] = ['n', 's', 'e', 'w', 'u', 'd'];

/// Clean up some player-input string.
export function sanify(desc: string): string {
  const pruned = desc.trim().replace(/[^\w\s,.'";:()<>!?&$%#/+=~-]/g, '');
  return pruned.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/// Converts a redis str to a 3D coordinate object.
export function strToPos(str: string): Pos {
  const match = /^(-?\d+),(-?\d+),(-?\d+)$/.exec(str);
  if (!match) {
    throw new Error(`Invalid pos \`${sanify(str)}\``);
  }
  return {x: Number(match[1]), y: Number(match[2]), z: Number(match[3])};
}

/// Converts a 3D coordinate to a redis str.
export function posToStr(pos: Pos): string {
  if (!('x' in pos) || !('y' in pos) || !('z' in pos)) {
    throw new Error(`Invalid Pos \`${sanify(pos.toString())}\``);
  }
  return `${pos.x},${pos.y},${pos.z}`;
}

/// Add a direction vector to a coordinate to yield a new coordinate.
export function addDirection(pos: Pos, direction: Direction): Pos {
  const { x, y, z } = pos;
  switch (direction) {
    case 'n': return { x, y: y - 1, z };
    case 's': return { x, y: y + 1, z };
    case 'e': return { x: x + 1, y, z };
    case 'w': return { x: x - 1, y, z };
    case 'u': return { x, y, z: z + 1 };
    case 'd': return { x, y, z: z - 1 };
    default: throw new Error(`Bad direction \`${sanify(direction)}\``);
  }
}
