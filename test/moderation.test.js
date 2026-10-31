import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkText } from '../moderation.js';

const blocked = ['you are so stupid', 'ur an idiot lol', 'what a l0ser', 'kys', 'k.y.s', 'go d1e', 'nobody likes you',
  'you’re worthless', 'youre such a fat freak', 'shut up b1tch', 'you  are   a   m o r o n', 'stuuupid? you are stuuupid'];
const allowed = ['I feel so stupid today', 'had a dumb day at work honestly', 'my cat is fat and happy',
  'Does anyone else feel worthless sometimes?', 'Assessment is tomorrow and I am scared', 'Scunthorpe is a town',
  'You are amazing, thank you', 'I made a mistake at work and feel awful', 'I believe in you!'];

test('blocks hurtful and belittling content', () => {
  for (const t of blocked) assert.equal(checkText(t).ok, false, t);
});
test('allows venting and kind messages', () => {
  for (const t of allowed) assert.equal(checkText(t).ok, true, t);
});
test('flags messages that need support without blocking them', () => {
  const r = checkText('honestly I just want to die some days');
  assert.equal(r.ok, true);
  assert.equal(r.support, true);
  assert.equal(checkText('lovely day').support, false);
});

import { checkTile } from '../moderation.js';
test('word tiles: kind words pass, put-downs and negations do not', () => {
  for (const w of ['sunshine', 'brave', 'Kindness', 'café']) assert.equal(checkTile(w).ok, true, w);
  for (const w of ['ugly', 'stupiiid', 'not', 'never', 'h8', 'kys', 'two words', 'idiots', '<b>']) assert.equal(checkTile(w).ok, false, w);
});
