import test from 'ava';
import { SPAWN, addDirection, sanify, strToPos, posToStr } from '../mud';

test('sanify', t => {
  t.is(sanify(' **A** '), 'A');
  t.is(sanify('what @   ever'), 'what ever');
});

test('strToPos', t => {
  t.deepEqual(strToPos(SPAWN), { x: 0, y: 0, z: 0 });
  t.deepEqual(strToPos('0,-10,300'), { x: 0, y: -10, z: 300 });
  t.throws(() => strToPos('1'));
  t.throws(() => strToPos('1,2,'));
  t.throws(() => strToPos('1,2,5,'));
  t.throws(() => strToPos('1,2,5,10'));
  t.throws(() => strToPos('1,,5'));
  t.throws(() => strToPos('1,-,5'));
  t.throws(() => strToPos('a,2,3'));
});

test('posToStr', t => {
  t.is(posToStr({ x: 0, y: 0, z: 0 }), SPAWN);
  t.is(posToStr({ x: 1, y: 2, z: -42 }), '1,2,-42');
  t.throws(() => posToStr({} as any));
});

test('addDirection', t => {
  const spawn = strToPos(SPAWN);
  t.is(posToStr(addDirection(spawn, 'n')), '0,-1,0');
  t.is(posToStr(addDirection(spawn, 's')), '0,1,0');
  t.is(posToStr(addDirection(spawn, 'e')), '1,0,0');
  t.is(posToStr(addDirection(spawn, 'w')), '-1,0,0');
  t.is(posToStr(addDirection(spawn, 'u')), '0,0,1');
  t.is(posToStr(addDirection(spawn, 'd')), '0,0,-1');
});
