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

test('severe vs fixable vs needs approval', () => {
  assert.equal(checkText('kys').severe, true);
  assert.equal(checkText('you are so stupid').severe, false);
  for (const msg of ['check out https://spam.example', 'visit cheapstuff.com now', 'email me at a.b@mail.com', 'call 555 123 4567', 'dm me on insta', 'add me @lonely_otter']) {
    const r = checkText(msg);
    assert.equal(r.ok, true, msg);
    assert.ok(r.hold, msg);
  }
  for (const msg of ['I walked 10000 steps today!', 'Is it okay to feel tired? Thanks.', 'Me and my friend went to the park.']) assert.equal(checkText(msg).hold, null, msg);
});
