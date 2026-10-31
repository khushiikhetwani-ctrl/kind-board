// Content moderation for Kindboard.
//
// Three tiers:
//   HARD      – always blocked (slurs, threats, telling people to hurt themselves).
//   DIRECTED  – belittling words, blocked when aimed at someone ("you're so stupid"),
//               but allowed about yourself ("I feel stupid today") so people can vent.
//   SUPPORT   – signs someone may be struggling. Never blocked; the author is gently
//               shown support resources instead.
//
// Matching is evasion-tolerant: case, accents, leetspeak (1d10t), stretched letters
// (stuuupid), zero-width characters and light punctuation (i.d.i.o.t) are all handled.
// Extend the lists below (or load a maintained list) for production use.

const HARD = [
  // self-harm encouragement & threats
  'kys', 'kill yourself', 'kill urself', 'kill your self', 'go die', 'hope you die', 'you should die',
  'u should die', 'end yourself', 'neck yourself', 'rope yourself', 'i will kill you', 'ill kill you',
  'i will hurt you', 'rape you', 'drink bleach',
  // abusive insults
  'fuck you', 'fuck u', 'stfu', 'cunt', 'bitch', 'whore', 'slut', 'asshole', 'dickhead', 'motherfucker',
  'bastard', 'piece of shit',
  // slurs
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'tranny', 'chink', 'spic', 'kike', 'wetback',
  'gook', 'raghead', 'towelhead', 'beaner',
  // dismissive phrases that cut deep on a board for lonely people
  'nobody likes you', 'no one likes you', 'nobody cares about you', 'no one cares about you',
  'nobody loves you', 'no one loves you', 'everyone hates you', 'you are nothing', 'youre nothing',
  'world is better without you', 'better off dead',
];

const DIRECTED = [
  'idiot', 'stupid', 'dumb', 'moron', 'loser', 'pathetic', 'worthless', 'useless', 'ugly', 'fat',
  'disgusting', 'freak', 'trash', 'garbage', 'failure', 'clown', 'imbecile', 'cringe', 'weirdo',
  'annoying', 'attention seeker', 'crybaby', 'waste of space', 'waste of air', 'mistake', 'joke',
];

const SUPPORT = [
  'kill myself', 'killing myself', 'want to die', 'wanna die', 'end my life', 'end it all', 'suicide',
  'suicidal', 'hurt myself', 'hurting myself', 'self harm', 'selfharm', 'cut myself', 'cutting myself',
  'no reason to live', 'dont want to be here', 'dont want to live', 'better off without me',
  'cant go on', 'give up on life',
];

const LEET = { 0: 'o', 1: 'i', '!': 'i', '|': 'i', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't', '+': 't', 8: 'b', 9: 'g' };

export function normalize(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/[​-‏⁠﻿­]/g, '') // zero-width / soft hyphen
    .toLowerCase()
    .replace(/[’`']/g, '') // "you're" -> "youre"
    .replace(/[0-9!|@$+]/g, (c) => LEET[c] ?? c);
}

const LETTER_GAP = '[._*~\\-\\s]?'; // allows i.d.i.o.t / i d i o t
const WORD_GAP = '[^a-z]+';

function phraseSource(phrase) {
  return phrase
    .split(' ')
    .map((word) => word.split('').map((ch) => `${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+`).join(LETTER_GAP))
    .join(WORD_GAP);
}

function buildRegex(list) {
  const alts = list.map(phraseSource).join('|');
  return new RegExp(`(?<![a-z])(?:${alts})(?:e?s|z|ed|ing)?(?![a-z])`, 'i');
}

const HARD_RE = buildRegex(HARD);
const SUPPORT_RE = buildRegex(SUPPORT);
// "you / u / ur / youre / your / ya" followed within a few words by a belittling term.
const DIRECTED_RE = new RegExp(
  `(?<![a-z])(?:you|u|ur|youre|your|ya|yall|ure)(?![a-z])(?:[^a-z]+[a-z]+){0,3}?[^a-z]+` +
    `(?:${DIRECTED.map(phraseSource).join('|')})(?:e?s|z)?(?![a-z])`,
  'i',
);
// "what a loser", "such an idiot", "ok boomer clown" style jabs
const JAB_RE = new RegExp(
  `(?<![a-z])(?:what an?|such an?|ur an?|youre an?|you an?|bunch of|total|absolute)[^a-z]+` +
    `(?:${DIRECTED.map(phraseSource).join('|')})(?:e?s|z)?(?![a-z])`,
  'i',
);

/**
 * @returns {{ ok: true, support: boolean } | { ok: false, reason: string }}
 */
export function checkText(text) {
  const t = normalize(text);
  if (HARD_RE.test(t)) {
    return { ok: false, reason: 'This note contains words that could hurt someone. Kindboard is a gentle place. Try saying it another way.' };
  }
  if (DIRECTED_RE.test(t) || JAB_RE.test(t)) {
    return { ok: false, reason: 'This reads as belittling someone. Disagreeing is fine, but putting people down isn’t. Try rephrasing?' };
  }
  return { ok: true, support: SUPPORT_RE.test(t) };
}

// A single custom word-play tile. Stricter than notes: on its own a tile has no
// context, so belittling words and negations ("not", "never") are refused outright.
const TILE_DENY = new RegExp(
  `^(?:${[...DIRECTED, 'not', 'no', 'never', 'nobody', 'none', 'nothing', 'hate', 'die', 'dead', 'death', 'kill', 'hurt', 'cut',
    'alone', 'lonely', 'sad', 'weak', 'small', 'slow', 'fail', 'gross', 'shut', 'stfu', 'gtfo']
    .map(phraseSource).join('|')})(?:e?s|z|ed|ing|n?t)?$`,
  'i',
);
export function checkTile(word) {
  const w = String(word || '').trim();
  if (!/^[\p{L}'’-]{1,18}$/u.test(w)) return { ok: false, reason: 'Tiles are single words (letters only, up to 18).' };
  const t = normalize(w);
  if (HARD_RE.test(t) || TILE_DENY.test(t) || TILE_DENY.test(t.replace(/(.)\1+/g, '$1'))) {
    return { ok: false, reason: 'That word can’t be a tile. Word play here is for kind sentences.' };
  }
  return { ok: true };
}
