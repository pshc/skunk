import test from 'ava';
import { sanify } from '../../mud/input';

test('sanify', t => {
  t.is(sanify(' **A** '), 'A');
  t.is(sanify('what @   ever'), 'what ever');
});
