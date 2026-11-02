// Kindboard — an anonymous, kind, community sticky-note board.
// Zero dependencies: Node's built-in http server, node:sqlite and Server-Sent Events.
//
// Every calendar day gets its own board. Today's board is open for notes, replies,
// stickers and word tiles; when the day ends it is archived — still readable (and
// shareable) forever, but nobody can edit it any more.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { checkText, checkTile } from './moderation.js';
import { quoteFor, quotesFor, wordsFor, isBankWord, DOODLES } from './content.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const scryptAsync = promisify(scrypt);

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(ROOT, 'kindboard.db'),
  // A hosted database (e.g. Turso, free tier) keeps everything safe even when the web server
  // restarts. Without these, data lives in the local file at DB_PATH.
  dbUrl: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || '',
  dbToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || '',
  adminKey: process.env.ADMIN_KEY || '',
  ipSalt: process.env.IP_SALT || 'change-me-in-production',
  timeZone: process.env.BOARD_TZ || 'UTC', // when "today" rolls over
  trustProxy: process.env.TRUST_PROXY === '1', // behind Render/Fly/Nginx etc.
  cookieSecure: process.env.COOKIE_SECURE === '1' ? true : process.env.COOKIE_SECURE === '0' ? false : null, // null = auto
  // Optional "Continue with Google". Only Google's anonymous account id is used, never email or name.
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''), // e.g. https://kind-board.onrender.com
  // Optional automatic check of hand-made stickers (Google Cloud Vision SafeSearch, free monthly quota).
  visionKey: process.env.GOOGLE_VISION_API_KEY || '',
  accountSalt: process.env.ACCOUNT_SALT || process.env.IP_SALT || 'change-me-in-production', // never change once people sign in
  flagsToHide: Number(process.env.FLAGS_TO_HIDE) || 3, // distinct reports → back to moderator review
  strikesToBan: 2,
  ipBanDays: 30, // after a pause, new identities from that network or device must use Google
  sessionDays: 30,
  maxText: 20000, // "no word limit" in practice — this only stops abuse
  boardW: 4000,
  boardH: 3000,
};

if (!process.env.IP_SALT) console.warn('[kindboard] IP_SALT not set. Set it in production.');
if (!CONFIG.adminKey) console.warn('[kindboard] ADMIN_KEY not set, so the moderation page is disabled.');

// ---------------------------------------------------------------- database

const db = createClient(CONFIG.dbUrl ? { url: CONFIG.dbUrl, authToken: CONFIG.dbToken || undefined } : { url: `file:${CONFIG.dbPath}` });
console.log(`[kindboard] database: ${CONFIG.dbUrl ? 'hosted (' + new URL(CONFIG.dbUrl.replace(/^libsql:/, 'https:')).host + ')' : 'local file'}`);

// Rows come back as plain objects; undefined arguments become NULL.
const toRow = (rs, row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]));
async function dbAll(sql, ...args) {
  const rs = await db.execute({ sql, args: args.map((a) => (a === undefined ? null : a)) });
  return rs.rows.map((row) => toRow(rs, row));
}
async function dbGet(sql, ...args) {
  return (await dbAll(sql, ...args))[0];
}
async function dbRun(sql, ...args) {
  await db.execute({ sql, args: args.map((a) => (a === undefined ? null : a)) });
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, animal TEXT NOT NULL,
    color TEXT NOT NULL, ip_hash TEXT, strikes INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  -- hidden: 0 visible, 1 removed by moderation, 2 deleted by its author
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL, color TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, rot REAL NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0, struck INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS replies (
    id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id), user_id TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, struck INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  -- kind: 'doodle' | 'emoji' | 'image' | 'word' | 'line'
  CREATE TABLE IF NOT EXISTS stickers (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL, content TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, size REAL NOT NULL,
    rot REAL NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, struck INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS my_stickers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS flags (
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (target_type, target_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS banned_ips (ip_hash TEXT PRIMARY KEY, until INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS notes_day ON notes(day, hidden);
  CREATE INDEX IF NOT EXISTS replies_note ON replies(note_id, hidden);
  CREATE INDEX IF NOT EXISTS stickers_day ON stickers(day, hidden);
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;
async function setupDatabase() {
  if (!CONFIG.dbUrl) await dbRun('PRAGMA journal_mode = WAL');
  await db.executeMultiple(SCHEMA);
  // Later additions (safe to run on existing databases).
  const cols = new Set((await dbAll('PRAGMA table_info(notes)')).map((c) => c.name));
  if (!cols.has('paper')) await dbRun("ALTER TABLE notes ADD COLUMN paper TEXT NOT NULL DEFAULT 'plain'");
  if (!cols.has('fastener')) await dbRun("ALTER TABLE notes ADD COLUMN fastener TEXT NOT NULL DEFAULT 'pin'");
  if (!cols.has('keep_clear')) await dbRun('ALTER TABLE notes ADD COLUMN keep_clear INTEGER NOT NULL DEFAULT 0'); // writer asked: no doodles over it
  const userCols = new Set((await dbAll('PRAGMA table_info(users)')).map((c) => c.name));
  if (!userCols.has('look')) await dbRun('ALTER TABLE users ADD COLUMN look TEXT'); // their pixel character, as JSON
  if (!userCols.has('variant')) await dbRun('ALTER TABLE users ADD COLUMN variant INTEGER'); // which version of their animal (colour + accessory)
  if (!userCols.has('avatar_mode')) await dbRun("ALTER TABLE users ADD COLUMN avatar_mode TEXT NOT NULL DEFAULT 'animal'"); // 'animal' or 'custom'
  if (!userCols.has('last_ip')) await dbRun('ALTER TABLE users ADD COLUMN last_ip TEXT'); // network of their latest sign-in (hashed)
  if (!userCols.has('google_hash')) await dbRun('ALTER TABLE users ADD COLUMN google_hash TEXT'); // salted hash of Google's anonymous id
  const replyCols = new Set((await dbAll('PRAGMA table_info(replies)')).map((c) => c.name));
  if (!replyCols.has('parent_id')) await dbRun('ALTER TABLE replies ADD COLUMN parent_id TEXT'); // reply to a reply
  for (const table of ['my_stickers', 'stickers']) {
    const c = new Set((await dbAll(`PRAGMA table_info(${table})`)).map((x) => x.name));
    if (!c.has('screen')) await dbRun(`ALTER TABLE ${table} ADD COLUMN screen TEXT`); // automatic image check result
  }
  await dbRun(`CREATE TABLE IF NOT EXISTS reactions (
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (target_type, target_id, user_id, emoji))`);
  await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_hash)');
}
const TABLES = { note: 'notes', reply: 'replies', sticker: 'stickers' };

// ---------------------------------------------------------------- helpers

const ANIMALS = [
  'Dog', 'Cat', 'Fox', 'Panda', 'Koala', 'Tiger', 'Lion', 'Frog', 'Owl', 'Penguin', 'Otter', 'Rabbit', 'Hamster',
  'Bear', 'Hedgehog', 'Turtle', 'Octopus', 'Whale', 'Dolphin', 'Butterfly', 'Bee', 'Ladybug', 'Sloth', 'Raccoon',
  'Deer', 'Duck', 'Swan', 'Flamingo', 'Parrot', 'Seal', 'Giraffe', 'Elephant', 'Snail', 'Crab', 'Mouse', 'Wolf',
  'Moose', 'Heron', 'Lynx', 'Badger', 'Robin', 'Sparrow', 'Moth', 'Lamb', 'Pony', 'Wren', 'Finch', 'Puffin',
];
const AVATAR_COLORS = ['#c2410c', '#b45309', '#a16207', '#4d7c0f', '#047857', '#0f766e', '#0369a1', '#4338ca', '#7e22ce', '#be185d', '#9f1239', '#57534e'];
const NOTE_COLORS = ['butter', 'blush', 'lime', 'lilac', 'sky', 'peach'];
const PAPERS = ['plain', 'lined', 'grid'];
const FASTENERS = ['pin', 'tape', 'none'];
const COMMON_PASSPHRASES = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678', '123456789', 'qwertyuiop', 'iloveyou',
  'kindboard', 'kindboard1', 'letmein123', 'qwerty123', 'abcdefghij', '0000000000', '1111111111', 'passphrase',
]);

const pick = (arr) => arr[randomInt(arr.length)];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = () => Date.now();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const jitter = (n) => Math.round((Math.random() * 2 - 1) * n * 10) / 10;
const given = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
// Positions default to somewhere near the middle of the board.
const posX = (v, w) => (given(v) ? clamp(v, 0, CONFIG.boardW - w) : CONFIG.boardW / 2 - w / 2 + jitter(300));
const posY = (v, h) => (given(v) ? clamp(v, 0, CONFIG.boardH - h) : CONFIG.boardH / 2 - h / 2 + jitter(220));

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => dayFormatter.format(new Date());
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

function clientIp(req) {
  if (CONFIG.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
const ipHash = (req) => sha(`${CONFIG.ipSalt}:${clientIp(req)}`);
const isHttps = (req) => CONFIG.cookieSecure ?? (req.socket.encrypted || (CONFIG.trustProxy && req.headers['x-forwarded-proto'] === 'https'));

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Simple in-memory sliding-window rate limiter.
const buckets = new Map();
function hits(key, windowMs) {
  const t = now();
  const list = (buckets.get(key) || []).filter((h) => t - h < windowMs);
  buckets.set(key, list);
  return list;
}
function rateLimit(key, max, windowMs, message = 'Slow down a little and try again in a moment.') {
  const list = hits(key, windowMs);
  if (list.length >= max) throw new HttpError(429, message);
  list.push(now());
}
setInterval(async () => {
  const t = now();
  for (const [k, list] of buckets) if (list.every((h) => t - h > 3_600_000)) buckets.delete(k);
  (await dbRun('DELETE FROM sessions WHERE expires_at < ?', t));
}, 600_000).unref();

// ---------------------------------------------------------------- accounts & sessions
//
// Identities are anonymous: a handle like "otter-4821" plus a passphrase the person
// chooses. Passphrases are hashed with scrypt (random salt per user). A successful
// login issues a random session token in an HttpOnly, SameSite=Strict cookie — page
// scripts never see it, and other sites can't send it.

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassphrase(pass) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pass.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassphrase(pass, stored) {
  const [scheme, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) {
    // Burn the same time as a real check so unknown handles can't be told apart.
    await scryptAsync('x', 'timing-equaliser', 64, SCRYPT);
    return false;
  }
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(String(pass).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}
function passphraseProblem(pass, handle) {
  const p = String(pass || '');
  if (p.length < 10) return 'Use at least 10 characters. A short phrase works well.';
  if (p.length > 200) return 'That password is too long.';
  if (COMMON_PASSPHRASES.has(p.toLowerCase()) || /^(.)\1+$/.test(p)) return 'That password is too easy to guess.';
  if (handle && p.toLowerCase().includes(handle.split('-')[0])) return 'Don’t include your animal name in your password.';
  return null;
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
// Several cookies can be set on one response (e.g. the Google return trip), so append rather than replace.
function addCookie(res, cookie) {
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(prev ? [].concat(prev) : []), cookie]);
}
function setSessionCookie(req, res, token, remember) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', ...(isHttps(req) ? ['Secure'] : [])];
  if (remember) attrs.push(`Max-Age=${CONFIG.sessionDays * 86400}`);
  addCookie(res, `kb_session=${token}; ${attrs.join('; ')}`);
}
function clearSessionCookie(req, res) {
  addCookie(res, `kb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}
async function startSession(req, res, userId, remember) {
  const token = randomBytes(32).toString('base64url');
  const ttl = remember ? CONFIG.sessionDays * 86_400_000 : 86_400_000; // non-remembered: 1 day max
  (await dbRun('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha(token), userId, now(), now() + ttl));
  (await dbRun('UPDATE users SET last_ip = ? WHERE id = ?', ipHash(req), userId));
  setSessionCookie(req, res, token, remember);
}
// Logins are remembered for a few seconds, so busy moments (live cursors, many people at once)
// don't each wait on a database round trip. Any change to a person drops their cached entry.
const sessionCache = new Map(); // token hash -> { user, until }
const SESSION_CACHE_MS = 15_000;
function forgetUser(userId) {
  for (const [k, v] of sessionCache) if (v.user?.id === userId) sessionCache.delete(k);
}
async function sessionUser(req) {
  const token = parseCookies(req).kb_session;
  if (!token || token.length > 100) return null;
  const key = sha(token);
  const hit = sessionCache.get(key);
  if (hit && hit.until > now()) return hit.user;
  const row = (await dbGet(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`, key, now())) || null;
  sessionCache.set(key, { user: row, until: now() + SESSION_CACHE_MS });
  if (sessionCache.size > 5000) sessionCache.delete(sessionCache.keys().next().value);
  return row;
}

const displayName = (u) => `Anonymous ${u.animal}`;
// A pixel character: hairstyle + indexes into the client's colour lists.
const HAIRSTYLES = ['bowl', 'short', 'curly', 'long', 'bun'];
function cleanLook(raw) {
  const n = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  return { style: HAIRSTYLES.includes(raw?.style) ? raw.style : 'short', skin: n(raw?.skin, 4), hair: n(raw?.hair, 5), suit: n(raw?.suit, 7) };
}
// 36 versions of every animal (6 tints x 6 accessories). Each new person gets one nobody with
// the same animal has yet, so two Anonymous Swans never look alike (until 36 Swans exist).
const VARIANTS = 36;
async function assignVariant(animal) {
  const used = new Set((await dbAll('SELECT variant FROM users WHERE animal = ? AND variant IS NOT NULL', animal)).map((r) => Number(r.variant)));
  const free = [];
  for (let v = 0; v < VARIANTS; v++) if (!used.has(v)) free.push(v);
  if (free.length) return free[randomInt(free.length)];
  // all taken: reuse the least common one
  const counts = await dbAll('SELECT variant, COUNT(*) AS c FROM users WHERE animal = ? GROUP BY variant ORDER BY c ASC LIMIT 1', animal);
  return Number(counts[0]?.variant ?? randomInt(VARIANTS));
}
const avatarMode = (u) => (u.avatar_mode === 'custom' && u.look ? 'custom' : 'animal');
function readLook(u) {
  try { return u.look ? cleanLook(JSON.parse(u.look)) : null; } catch { return null; }
}

function publicMe(u) {
  return {
    look: readLook(u),
    variant: Number(u.variant) || 0, avatarMode: avatarMode(u),
    google: !!u.google_hash,
    hasPassword: !!u.pass_hash && u.pass_hash !== '!',
    handle: u.handle, name: displayName(u), animal: u.animal, color: u.color,
    strikes: u.strikes, banned: !!u.banned, strikesToBan: CONFIG.strikesToBan,
  };
}

function requireUser(user) {
  if (!user) throw new HttpError(401, 'Please log in first.', { auth: true });
  return user;
}
function requirePoster(user) {
  requireUser(user);
  if (user.banned) throw new HttpError(403, 'This identity was paused after 2 strikes. You can still read the board.', { banned: true });
  return user;
}
function requireToday(day) {
  if (day !== today()) throw new HttpError(403, 'This day has been archived. It can be viewed, but not edited.', { archived: true });
}

// ---------------------------------------------------------------- moderation

// hidden = 3 means "waiting for approval": only its author can see it until a moderator approves.
const PENDING = 3;
const visibleTo = (alias = '') => `(${alias}hidden = 0 OR (${alias}hidden = ${PENDING} AND ${alias}user_id = ?))`;

// Every post is checked automatically. Clearly harmful text is refused and counts as a
// strike; unkind-but-fixable text is refused so it can be rephrased; text a filter can't
// judge (links, contact details) is accepted but held for approval.
async function moderate(text, user) {
  const result = checkText(text);
  if (!result.ok) {
    let message = result.reason;
    if (result.severe && user) {
      (await addStrike(user.id));
      const u = (await dbGet('SELECT strikes, banned FROM users WHERE id = ?', user.id));
      message += u.banned
        ? ' That was a second strike, so this identity is now paused. You can still read.'
        : ` This counts as a strike (${u.strikes} of ${CONFIG.strikesToBan}).`;
    }
    throw new HttpError(422, message, { moderation: true, strike: !!result.severe, ...(result.severe && user ? { paused: !!(await dbGet('SELECT banned FROM users WHERE id = ?', user.id))?.banned } : {}) });
  }
  return { support: result.support, hold: result.hold };
}

// Send an item to everyone, or only to its author while it waits for approval.
function emit(event, item, row) {
  if (row.hidden === PENDING) sendTo(row.user_id, event, forViewer(item, row.user_id));
  else broadcast(event, item);
}

async function addStrike(userId) {
  const u = (await dbGet('SELECT * FROM users WHERE id = ?', userId));
  if (!u) return;
  const strikes = u.strikes + 1;
  const banned = strikes >= CONFIG.strikesToBan ? 1 : 0;
  (await dbRun('UPDATE users SET strikes = ?, banned = ? WHERE id = ?', strikes, banned, userId));
  forgetUser(userId);
  if (banned && !u.banned) {
    // Their networks (where they signed up and last signed in) can only start new identities through Google.
    for (const ip of new Set([u.ip_hash, u.last_ip].filter(Boolean))) {
      (await dbRun('INSERT OR REPLACE INTO banned_ips (ip_hash, until) VALUES (?, ?)', ip, now() + CONFIG.ipBanDays * 86_400_000));
    }
    // A banned identity's content leaves the board.
    for (const [type, table] of Object.entries(TABLES)) {
      for (const row of (await dbAll(`SELECT id FROM ${table} WHERE user_id = ? AND hidden = 0`, userId))) {
        (await dbRun(`UPDATE ${table} SET hidden = 1 WHERE id = ?`, row.id));
        (await broadcastRemoval(type, row.id));
      }
    }
  }
  sendTo(userId, 'me', publicMe({ ...u, strikes, banned }));
}

async function removeStrike(userId) {
  const u = (await dbGet('SELECT * FROM users WHERE id = ?', userId));
  if (!u) return;
  const strikes = Math.max(0, u.strikes - 1);
  const banned = strikes >= CONFIG.strikesToBan ? 1 : 0;
  (await dbRun('UPDATE users SET strikes = ?, banned = ? WHERE id = ?', strikes, banned, userId));
  forgetUser(userId);
  if (!banned && u.banned) for (const ip of [u.ip_hash, u.last_ip].filter(Boolean)) (await dbRun('DELETE FROM banned_ips WHERE ip_hash = ?', ip));
  sendTo(userId, 'me', publicMe({ ...u, strikes, banned }));
}

async function hideForModeration(type, id) {
  const table = TABLES[type];
  const row = (await dbGet(`SELECT * FROM ${table} WHERE id = ?`, id));
  if (!row) return;
  (await dbRun(`UPDATE ${table} SET hidden = 1, struck = 1 WHERE id = ?`, id));
  if (row.hidden === 0) (await broadcastRemoval(type, id));
  if (!row.struck) (await addStrike(row.user_id));
}

// ---------------------------------------------------------------- serializers

const NOTE_SQL = `
  SELECT n.*, u.animal, u.color AS avatar, u.look, u.variant, u.avatar_mode,
    (SELECT COUNT(*) FROM replies r WHERE r.note_id = n.id AND r.hidden = 0) AS reply_count
  FROM notes n JOIN users u ON u.id = n.user_id`;
const REPLY_SQL = `SELECT r.*, u.animal, u.color AS avatar, u.look, u.variant, u.avatar_mode FROM replies r JOIN users u ON u.id = r.user_id`;

// ---- emoji reactions: a small, kind set
const REACTIONS = ['\u{1F49B}', '\u{1F917}', '\u{1FAF6}', '\u{1F60A}', '\u{1F64F}', '\u{1F331}']; // 💛 🤗 🫶 😊 🙏 🌱
// Any emoji can be a reaction, except a few that are mostly used to mock or hurt.
const BLOCKED_REACTIONS = new Set([...'🖕💩🔪🗡⚔🔫💣🤡🤮🤢💀☠🪓🩸🍆🍑💦👅😈👿🤬😡😠🙄🥱😒🤥🫵👎🗯👹👺🔞💢'].filter((ch) => ch.trim()));
const EMOJI_RE = /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
function reactionProblem(emoji) {
  const e = String(emoji || '');
  if (!e || e.length > 24 || !EMOJI_RE.test(e)) return 'That isn\u2019t a single emoji.';
  const bare = e.replace(/[\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, ''); // ignore variation selectors and skin tones
  for (const ch of bare.split('\u200D')) if (BLOCKED_REACTIONS.has(ch)) return 'Let\u2019s keep reactions kind. Try another one?';
  return null;
}
// { targetId: { emoji: { n, mine } } } for a set of notes or replies
async function reactionsFor(type, idsSql, args, viewerId) {
  const rows = await dbAll(`SELECT target_id, emoji, COUNT(*) AS n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
    FROM reactions WHERE target_type = ? AND target_id IN (${idsSql}) GROUP BY target_id, emoji`, viewerId, type, ...args);
  const out = {};
  for (const r of rows) (out[r.target_id] ??= {})[r.emoji] = { n: r.n, mine: r.mine > 0 };
  return out;
}

const noteOut = (r) => ({
  id: r.id, day: r.day, text: r.text, color: r.color, paper: r.paper, fastener: r.fastener, keepClear: !!r.keep_clear, x: r.x, y: r.y, rot: r.rot, pending: r.hidden === PENDING,
  name: `Anonymous ${r.animal}`, animal: r.animal, avatar: r.avatar, look: readLook(r), variant: Number(r.variant) || 0, avatarMode: avatarMode(r), createdAt: r.created_at, replyCount: r.reply_count, userId: r.user_id,
});
const replyOut = (r) => ({
  id: r.id, noteId: r.note_id, parentId: r.parent_id || null, text: r.text, pending: r.hidden === PENDING, name: `Anonymous ${r.animal}`, animal: r.animal, avatar: r.avatar, look: readLook(r), variant: Number(r.variant) || 0, avatarMode: avatarMode(r), createdAt: r.created_at, userId: r.user_id,
});
const stickerOut = (r) => ({
  id: r.id, day: r.day, kind: r.kind, content: r.content, pending: r.hidden === PENDING, x: r.x, y: r.y, size: r.size, rot: r.rot, userId: r.user_id,
});
// Never expose internal user ids: replace them with a per-viewer "mine" flag.
const forViewer = (item, viewerId) => {
  const { userId, ...rest } = item;
  return { ...rest, mine: !!viewerId && userId === viewerId };
};
const getNote = async (id) => {
  const r = (await dbGet(`${NOTE_SQL} WHERE n.id = ?`, id));
  return r ? noteOut(r) : null;
};

// ---------------------------------------------------------------- live updates (SSE)

const clients = new Set();

function openStream(req, res, user) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { res, userId: user.id };
  clients.add(client);
  broadcastPresence();
  req.on('close', () => {
    clients.delete(client);
    broadcastPresence();
  });
}

const write = (client, event, data) => client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function broadcast(event, item) {
  for (const c of clients) write(c, event, item.userId !== undefined ? forViewer(item, c.userId) : item);
}
function sendTo(userId, event, data) {
  for (const c of clients) if (c.userId === userId) write(c, event, data);
}
async function broadcastRemoval(type, id) {
  const extra = type === 'reply' ? { noteId: (await dbGet('SELECT note_id FROM replies WHERE id = ?', id))?.note_id } : {};
  broadcast('removed', { type, id, ...extra });
}
let presenceTimer;
function broadcastPresence() {
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => broadcast('presence', { online: clients.size }), 300);
}
setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 15_000).unref();

// ---------------------------------------------------------------- request plumbing

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'That is too large to post.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid request.');
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// CSRF defence in depth (on top of SameSite=Strict): state-changing requests must
// carry our custom header (impossible cross-origin without a CORS preflight, which we
// never grant) and, when the browser sends one, an Origin matching this host.
function checkCsrf(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-kindboard'] !== '1') throw new HttpError(403, 'Request blocked.');
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Request blocked.');
}

function cleanText(text) {
  const t = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!t) throw new HttpError(400, 'Write something first.');
  if (t.length > CONFIG.maxText) throw new HttpError(400, `That is a lot! Notes can be up to ${CONFIG.maxText.toLocaleString()} characters.`);
  return t;
}

function validPng(dataUrl, maxBytes = 150 * 1024) {
  const prefix = 'data:image/png;base64,';
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return false;
  const buf = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  return buf.length > 8 && buf.length <= maxBytes && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

async function ownedRow(type, id, user) {
  const row = (await dbGet(`SELECT * FROM ${TABLES[type]} WHERE id = ? AND hidden IN (0, ${PENDING})`, id));
  if (!row) throw new HttpError(404, 'That is no longer on the board.');
  if (row.user_id !== user.id) throw new HttpError(403, 'You can only change your own things.');
  return row;
}
const dayOf = async (type, row) => (type === 'reply' ? (await dbGet('SELECT day FROM notes WHERE id = ?', row.note_id))?.day : row.day);

// ---------------------------------------------------------------- routes

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// Public: the landing page needs only these.
route('GET', /^\/api\/config$/, async () => ({
  today: today(), timeZone: CONFIG.timeZone, boardW: CONFIG.boardW, boardH: CONFIG.boardH,
  google: googleReady(),
  reactions: REACTIONS,
  noteColors: NOTE_COLORS, lineColors: LINE_COLORS, papers: PAPERS, fasteners: FASTENERS, strikesToBan: CONFIG.strikesToBan, flagsToHide: CONFIG.flagsToHide, animals: ANIMALS,
}));
route('GET', /^\/api\/quote$/, async () => {
  const day = today();
  const stats = (await dbGet(`SELECT COUNT(*) AS notes FROM notes WHERE day = ? AND hidden = 0`, day));
  const replies = (await dbGet(`SELECT COUNT(*) AS c FROM replies r JOIN notes n ON n.id = r.note_id WHERE n.day = ? AND r.hidden = 0`, day));
  return { day, quote: quoteFor(day), quotes: quotesFor(day), notes: stats.notes, replies: replies.c, online: clients.size };
});

// After an identity is paused (2 strikes), its networks and device can't simply make a fresh
// password identity. New identities from there must come through Google, where one Google
// account is one identity for good, so a paused person can't keep starting over.
const DEVICE_MARK = 'kb_mark';
function markDevice(req, res) {
  if (parseCookies(req)[DEVICE_MARK]) return;
  addCookie(res, `${DEVICE_MARK}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${isHttps(req) ? '; Secure' : ''}`);
}
async function signupAllowed(ip, req, { viaGoogle = false } = {}) {
  if (hits(`signup:${ip}`, 3_600_000).length >= 10) throw new HttpError(429, 'Too many new identities from here. Try again later.');
  if (viaGoogle) return; // a Google account that's already paused just signs back in to its paused identity
  const ban = (await dbGet('SELECT until FROM banned_ips WHERE ip_hash = ?', ip));
  const flagged = (ban && ban.until > now()) || !!parseCookies(req)[DEVICE_MARK];
  if (!flagged) return;
  if (googleReady()) throw new HttpError(403, 'To start a new identity here, please use Continue with Google. (An identity on this network or device was paused for breaking the rules.)', { banned: true, needGoogle: true });
  throw new HttpError(403, 'New identities are paused from this network for a little while.', { banned: true });
}
async function newHandle(animal) {
  for (let i = 0; i < 20; i++) {
    const candidate = `${animal.toLowerCase()}-${randomInt(1000, 10000)}`;
    if (!(await dbGet('SELECT 1 FROM users WHERE handle = ?', candidate))) return candidate;
  }
  throw new HttpError(503, 'Please try again.');
}

route('POST', /^\/api\/signup$/, async ({ req, res }) => {
  const ip = ipHash(req);
  (await signupAllowed(ip, req));
  const body = await readJson(req);
  const animal = ANIMALS.includes(body.animal) ? body.animal : pick(ANIMALS);
  const handle = (await newHandle(animal));
  const problem = passphraseProblem(body.passphrase, handle);
  if (problem) throw new HttpError(400, problem, { field: 'passphrase' });
  hits(`signup:${ip}`, 3_600_000).push(now()); // only real sign-ups count toward the limit
  const id = randomUUID();
  (await dbRun('INSERT INTO users (id, handle, pass_hash, animal, color, ip_hash, created_at, variant) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, handle, await hashPassphrase(body.passphrase), animal, pick(AVATAR_COLORS), ip, now(), await assignVariant(animal)));
  (await startSession(req, res, id, !!body.remember));
  return { me: publicMe((await dbGet('SELECT * FROM users WHERE id = ?', id))) };
});

route('POST', /^\/api\/login$/, async ({ req, res }) => {
  const ip = ipHash(req);
  const body = await readJson(req);
  const handle = String(body.handle || '').trim().toLowerCase().replace(/\s+/g, '-');
  rateLimit(`login-ip:${ip}`, 20, 900_000, 'Too many attempts. Wait a few minutes.');
  // Per-handle lockout stops slow, distributed guessing against one identity.
  if (hits(`login-fail:${handle}`, 900_000).length >= 8) throw new HttpError(429, 'This handle is locked for 15 minutes after too many attempts.');
  const user = /^[a-z]+-\d{4}$/.test(handle) ? (await dbGet('SELECT * FROM users WHERE handle = ?', handle)) : null;
  const ok = await verifyPassphrase(body.passphrase, user?.pass_hash);
  if (!user || !ok) {
    hits(`login-fail:${handle}`, 900_000).push(now());
    throw new HttpError(401, 'That handle and password don’t match.');
  }
  (await startSession(req, res, user.id, !!body.remember));
  return { me: publicMe(user) };
});

route('POST', /^\/api\/logout$/, async ({ req, res }) => {
  const token = parseCookies(req).kb_session;
  if (token) { (await dbRun('DELETE FROM sessions WHERE token_hash = ?', sha(token))); sessionCache.delete(sha(token)); }
  clearSessionCookie(req, res);
  return { ok: true };
});

route('POST', /^\/api\/logout-everywhere$/, async ({ req, res, user }) => {
  requireUser(user);
  (await dbRun('DELETE FROM sessions WHERE user_id = ?', user.id));
  forgetUser(user.id);
  clearSessionCookie(req, res);
  return { ok: true };
});

route('GET', /^\/api\/me$/, async ({ user }) => ({ me: user ? publicMe(user) : null }));

// ---- Continue with Google (OpenID Connect, authorization code flow with PKCE)
// We request only the "openid" scope, so Google tells us nothing but a stable, anonymous
// account id ("sub"). We store a salted hash of it, never the id itself, and no email or name.
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'; // overridable for tests
const googleReady = () => !!(CONFIG.googleClientId && CONFIG.googleClientSecret && CONFIG.publicUrl);
const googleRedirect = () => `${CONFIG.publicUrl}/auth/google/callback`;
const googleHash = (sub) => sha(`${CONFIG.accountSalt}:google:${sub}`);
const oauthPending = new Map(); // state -> { verifier, nonce, mode, userId, remember, animal, at }
setInterval(() => {
  for (const [k, v] of oauthPending) if (now() - v.at > 600_000) oauthPending.delete(k);
}, 120_000).unref();

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

async function googleStart(req, res, url) {
  if (!googleReady()) return redirect(res, '/login?google=off');
  rateLimit(`gstart:${ipHash(req)}`, 30, 600_000);
  const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
  const user = (await sessionUser(req));
  if (mode === 'link' && !user) return redirect(res, '/login');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const animal = url.searchParams.get('animal');
  oauthPending.set(state, {
    verifier, nonce, mode, userId: user?.id || null, at: now(),
    remember: url.searchParams.get('remember') !== '0', animal: ANIMALS.includes(animal) ? animal : null,
  });
  // binds the round trip to this browser (Lax so it survives the redirect back from Google)
  addCookie(res, `kb_oauth=${state}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}`);
  const params = new URLSearchParams({
    client_id: CONFIG.googleClientId, redirect_uri: googleRedirect(), response_type: 'code', scope: 'openid',
    state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account',
  });
  return redirect(res, `${GOOGLE_AUTH}?${params}`);
}

async function googleCallback(req, res, url) {
  const fail = (why) => redirect(res, `/login?google=${why}`);
  const state = url.searchParams.get('state') || '';
  const pending = oauthPending.get(state);
  oauthPending.delete(state);
  addCookie(res, 'kb_oauth=; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=0');
  if (!pending || parseCookies(req).kb_oauth !== state || now() - pending.at > 600_000) return fail('expired');
  if (url.searchParams.get('error')) return fail('cancelled');
  let claims;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code') || '', client_id: CONFIG.googleClientId, client_secret: CONFIG.googleClientSecret,
        redirect_uri: googleRedirect(), grant_type: 'authorization_code', code_verifier: pending.verifier,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.id_token) return fail('error');
    // The id token came straight from Google's token endpoint over TLS, so its claims can be trusted
    // (OpenID Connect Core §3.1.3.7); we still check who it's for, who issued it, freshness and the nonce.
    claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return fail('error');
  }
  const okIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!okIssuer || claims.aud !== CONFIG.googleClientId || claims.nonce !== pending.nonce || !claims.sub || claims.exp * 1000 < now()) return fail('error');
  const gHash = googleHash(claims.sub);
  const owner = (await dbGet('SELECT * FROM users WHERE google_hash = ?', gHash));

  if (pending.mode === 'link') {
    if (owner && owner.id !== pending.userId) return redirect(res, '/calendar?google=taken');
    (await dbRun('UPDATE users SET google_hash = ? WHERE id = ?', gHash, pending.userId));
    forgetUser(pending.userId);
    return redirect(res, '/calendar?google=linked');
  }
  if (owner) {
    (await startSession(req, res, owner.id, pending.remember));
    return redirect(res, '/calendar?google=welcome-back');
  }
  // first time with this Google account: a brand-new anonymous identity
  const ip = ipHash(req);
  try {
    (await signupAllowed(ip, req, { viaGoogle: true }));
  } catch (err) {
    return fail(err.extra?.banned ? 'paused' : 'busy');
  }
  hits(`signup:${ip}`, 3_600_000).push(now());
  const animal = pending.animal || pick(ANIMALS);
  const id = randomUUID();
  (await dbRun('INSERT INTO users (id, handle, pass_hash, animal, color, ip_hash, google_hash, created_at, variant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, (await newHandle(animal)), '!', animal, pick(AVATAR_COLORS), ip, gHash, now(), await assignVariant(animal))); // '!' = no password; Google is the key
  (await startSession(req, res, id, pending.remember));
  return redirect(res, '/calendar?google=new');
}

route('DELETE', /^\/api\/me\/google$/, async ({ user }) => {
  requireUser(user);
  if (!user.pass_hash || user.pass_hash === '!') throw new HttpError(400, 'Google is the only way into this identity, so it can\u2019t be removed.');
  (await dbRun('UPDATE users SET google_hash = NULL WHERE id = ?', user.id));
  forgetUser(user.id);
  return { me: publicMe({ ...user, google_hash: null }) };
});

route('PUT', /^\/api\/me\/look$/, async ({ req, user }) => {
  requireUser(user);
  rateLimit(`look:${user.id}`, 30, 600_000);
  const look = cleanLook(await readJson(req, 1024));
  (await dbRun("UPDATE users SET look = ?, avatar_mode = 'custom' WHERE id = ?", JSON.stringify(look), user.id));
  forgetUser(user.id);
  return { me: publicMe({ ...user, look: JSON.stringify(look), avatar_mode: 'custom' }) };
});

// Switch between their animal and their custom character.
route('PUT', /^\/api\/me\/avatar$/, async ({ req, user }) => {
  requireUser(user);
  rateLimit(`look:${user.id}`, 30, 600_000);
  const body = await readJson(req, 256);
  const mode = body.mode === 'custom' && user.look ? 'custom' : 'animal';
  (await dbRun('UPDATE users SET avatar_mode = ? WHERE id = ?', mode, user.id));
  forgetUser(user.id);
  return { me: publicMe({ ...user, avatar_mode: mode }) };
});

route('GET', /^\/api\/board$/, async ({ url, user }) => {
  requireUser(user);
  const day = url.searchParams.get('day') || today();
  if (!isDay(day)) throw new HttpError(400, 'Invalid date.');
  if (day > today()) throw new HttpError(404, 'That day hasn’t happened yet.');
  const notes = (await dbAll(`${NOTE_SQL} WHERE n.day = ? AND ${visibleTo('n.')} ORDER BY n.created_at`, day, user.id)).map(noteOut);
  const stickers = (await dbAll(`SELECT * FROM stickers WHERE day = ? AND ${visibleTo()} ORDER BY created_at`, day, user.id)).map(stickerOut);
  const reacts = await reactionsFor('note', 'SELECT id FROM notes WHERE day = ?', [day], user.id);
  for (const n of notes) n.reactions = reacts[n.id] || {};
  return {
    day, today: today(), archived: day !== today(), quote: quoteFor(day),
    notes: notes.map((n) => forViewer(n, user.id)),
    stickers: stickers.map((s) => forViewer(s, user.id)),
  };
});

route('GET', /^\/api\/calendar$/, async ({ url, user }) => {
  requireUser(user);
  const month = url.searchParams.get('month') || today().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Invalid month.');
  const days = {};
  for (const r of (await dbAll(`SELECT day, COUNT(*) AS c, GROUP_CONCAT(color) AS colors FROM notes WHERE day LIKE ? AND hidden = 0 GROUP BY day`, `${month}-%`))) {
    days[r.day] = { notes: r.c, replies: 0, colors: r.colors.split(',').slice(0, 8), preview: null };
  }
  for (const r of (await dbAll(`SELECT n.day, COUNT(*) AS c FROM replies r JOIN notes n ON n.id = r.note_id
                     WHERE n.day LIKE ? AND r.hidden = 0 AND n.hidden = 0 GROUP BY n.day`, `${month}-%`))) {
    if (days[r.day]) days[r.day].replies = r.c;
  }
  // A short line from the most-replied note of each day, for the calendar preview (one query for the month).
  const tops = await dbAll(`
    SELECT day, text FROM (
      SELECT n.day, n.text, ROW_NUMBER() OVER (
        PARTITION BY n.day
        ORDER BY (SELECT COUNT(*) FROM replies r WHERE r.note_id = n.id AND r.hidden = 0) DESC, n.created_at
      ) AS rn
      FROM notes n WHERE n.day LIKE ? AND n.hidden = 0
    ) WHERE rn = 1`, `${month}-%`);
  for (const t of tops) if (days[t.day]) days[t.day].preview = t.text.slice(0, 90);
  return { month, today: today(), days };
});

route('GET', /^\/api\/words$/, async ({ url, user }) => {
  requireUser(user);
  const day = url.searchParams.get('day') || today();
  return wordsFor(isDay(day) ? day : today());
});

route('POST', /^\/api\/notes$/, async ({ req, user }) => {
  requirePoster(user);
  const body = await readJson(req);
  const day = today();
  const text = cleanText(body.text);
  const { support, hold } = (await moderate(text, user));
  rateLimit(`note:${user.id}`, 4, 60_000, 'You’ve pinned a few notes quickly. Take a breath and try again in a minute.');
  const color = NOTE_COLORS.includes(body.color) ? body.color : 'butter';
  const paper = PAPERS.includes(body.paper) ? body.paper : 'plain';
  const fastener = FASTENERS.includes(body.fastener) ? body.fastener : 'pin';
  const id = randomUUID();
  (await dbRun('INSERT INTO notes (id, day, user_id, text, color, paper, fastener, keep_clear, x, y, rot, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, day, user.id, text, color, paper, fastener, body.keepClear ? 1 : 0, posX(body.x, 260), posY(body.y, 200), jitter(4), hold ? PENDING : 0, now()));
  const note = (await getNote(id));
  emit('note', note, { hidden: hold ? PENDING : 0, user_id: user.id });
  return { note: forViewer(note, user.id), support, pending: hold };
});

route('POST', /^\/api\/notes\/check$/, async ({ req, user }) => {
  requirePoster(user);
  requireToday(today());
  const { hold } = (await moderate(cleanText((await readJson(req)).text), user));
  return { ok: true, pending: hold };
});

// Live cursors: where other people are on today's board. Ephemeral — never stored.
const cursorTag = (userId, day) => sha(`${CONFIG.ipSalt}:cursor:${userId}:${day}`).slice(0, 12);
route('POST', /^\/api\/cursor$/, async ({ req, user }) => {
  requireUser(user);
  const body = await readJson(req, 512);
  if (!isDay(body.day) || body.day > today()) throw new HttpError(400, 'Invalid day.');
  if (hits(`cursor:${user.id}`, 1000).length >= 8) return { ok: true }; // silently drop floods
  hits(`cursor:${user.id}`, 1000).push(now());
  broadcast('cursor', {
    tag: cursorTag(user.id, body.day), day: body.day, gone: !!body.gone,
    x: clamp(body.x, 0, CONFIG.boardW), y: clamp(body.y, 0, CONFIG.boardH),
    name: user.banned ? 'Someone' : displayName(user), animal: user.animal, color: user.color, userId: user.id,
  });
  return { ok: true };
});

route('PATCH', /^\/api\/notes\/([\w-]+)$/, async ({ req, user, params }) => {
  requirePoster(user);
  // Notes can be rearranged by anyone, like a shared corkboard. Waiting notes only by their writer.
  const row = (await dbGet(`SELECT * FROM notes WHERE id = ? AND ${visibleTo()}`, params[0], user.id));
  if (!row) throw new HttpError(404, 'That is no longer on the board.');
  rateLimit(`move:${user.id}`, 90, 60_000, 'Lots of rearranging! Give it a moment.');
  requireToday(row.day);
  const body = await readJson(req);
  (await dbRun('UPDATE notes SET x = ?, y = ? WHERE id = ?', posX(body.x, 260), posY(body.y, 200), row.id));
  const note = (await getNote(row.id));
  emit('note', note, row);
  return { note: forViewer(note, user.id) };
});

route('GET', /^\/api\/notes\/([\w-]+)$/, async ({ user, params }) => {
  requireUser(user);
  const r = (await dbGet(`${NOTE_SQL} WHERE n.id = ? AND ${visibleTo('n.')}`, params[0], user.id));
  if (!r) throw new HttpError(404, 'This note is no longer on the board.');
  const replies = (await dbAll(`${REPLY_SQL} WHERE r.note_id = ? AND ${visibleTo('r.')} ORDER BY r.created_at`, params[0], user.id)).map(replyOut);
  const noteReacts = await reactionsFor('note', '?', [params[0]], user.id);
  const replyReacts = await reactionsFor('reply', 'SELECT id FROM replies WHERE note_id = ?', [params[0]], user.id);
  for (const x of replies) x.reactions = replyReacts[x.id] || {};
  const note = noteOut(r);
  note.reactions = noteReacts[r.id] || {};
  return { note: forViewer(note, user.id), replies: replies.map((x) => forViewer(x, user.id)), archived: r.day !== today() };
});

route('POST', /^\/api\/notes\/([\w-]+)\/replies$/, async ({ req, user, params }) => {
  requirePoster(user);
  const note = (await dbGet('SELECT * FROM notes WHERE id = ? AND hidden IN (0, ?)', params[0], PENDING));
  if (!note || (note.hidden === PENDING && note.user_id !== user.id)) throw new HttpError(404, 'This note is no longer on the board.');
  if (note.hidden === PENDING) throw new HttpError(403, 'Replies open once this note is approved.');
  requireToday(note.day);
  const body = await readJson(req);
  const text = cleanText(body.text);
  let parentId = null;
  if (body.parentId) {
    const parent = await dbGet('SELECT id, parent_id FROM replies WHERE id = ? AND note_id = ? AND hidden = 0', String(body.parentId), note.id);
    if (!parent) throw new HttpError(404, 'That reply is no longer here.');
    parentId = parent.parent_id || parent.id; // one level of threading keeps conversations easy to follow
  }
  const { support, hold } = (await moderate(text, user));
  rateLimit(`reply:${user.id}`, 10, 60_000);
  const id = randomUUID();
  (await dbRun('INSERT INTO replies (id, note_id, user_id, text, hidden, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, note.id, user.id, text, hold ? PENDING : 0, parentId, now()));
  const reply = replyOut((await dbGet(`${REPLY_SQL} WHERE r.id = ?`, id)));
  emit('reply', { ...reply, day: note.day }, { hidden: hold ? PENDING : 0, user_id: user.id });
  if (!hold) broadcast('note', (await getNote(note.id))); // refresh reply count
  return { reply: forViewer(reply, user.id), support, pending: hold };
});

route('POST', /^\/api\/react$/, async ({ req, user }) => {
  requirePoster(user);
  const { type, id, emoji } = await readJson(req, 1024);
  if (!['note', 'reply'].includes(type)) throw new HttpError(400, 'Unknown item.');
  const problem = reactionProblem(emoji);
  if (problem) throw new HttpError(400, problem);
  const row = await dbGet(`SELECT * FROM ${TABLES[type]} WHERE id = ? AND hidden = 0`, String(id));
  if (!row) throw new HttpError(404, 'That is no longer on the board.');
  const day = await dayOf(type, row);
  requireToday(day);
  rateLimit(`react:${user.id}`, 90, 60_000, 'Lots of reactions! Give it a moment.');
  const had = await dbGet('SELECT 1 AS x FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND emoji = ?', type, row.id, user.id, emoji);
  if (!had) {
    const mine = await dbGet('SELECT COUNT(*) AS n FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ?', type, row.id, user.id);
    if (mine.n >= 8) throw new HttpError(429, 'That\u2019s plenty of reactions for one post.');
  }
  if (had) await dbRun('DELETE FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND emoji = ?', type, row.id, user.id, emoji);
  else await dbRun('INSERT INTO reactions (target_type, target_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)', type, row.id, user.id, emoji, now());
  const counts = {};
  for (const r of await dbAll('SELECT emoji, COUNT(*) AS n FROM reactions WHERE target_type = ? AND target_id = ? GROUP BY emoji', type, row.id)) counts[r.emoji] = r.n;
  broadcast('reactions', { type, id: row.id, noteId: type === 'reply' ? row.note_id : row.id, day, counts });
  return { counts, mine: !had };
});

// A squiggly line: points relative to its top-left corner, plus colour and thickness.
const LINE_COLORS = ['#161513', '#8f3f1c', '#c2410c', '#ca8a04', '#3f7d3a', '#0f766e', '#2b6cb0', '#6d65d8', '#be185d', '#ffffff'];
const BRUSHES = ['pen', 'pencil', 'crayon', 'highlighter', 'paint'];
// Word tiles remember the look they were placed with.
const TILE_STYLES = ['clipping', 'magnet', 'plain', 'pixel', 'funky', 'alien', 'doodle'];
const TILE_FONTS = ['auto', 'oldprint', 'typewriter', 'boldserif', 'classic', 'rounded', 'pixel', 'funky', 'block', 'space', 'hand', 'script', 'clean'];
function cleanLine(raw) {
  const pts = Array.isArray(raw?.p) ? raw.p : [];
  if (pts.length < 2 || pts.length > 600) throw new HttpError(400, 'That line is too short or too long.');
  const p = pts.map((pt) => {
    if (!Array.isArray(pt) || pt.length !== 2) throw new HttpError(400, 'Invalid line.');
    return [Math.round(clamp(pt[0], 0, 3000)), Math.round(clamp(pt[1], 0, 3000))];
  });
  const c = LINE_COLORS.includes(raw.c) ? raw.c : LINE_COLORS[0];
  const b = BRUSHES.includes(raw.b) ? raw.b : 'pen';
  const w = Math.round(clamp(raw.w, 1, b === 'highlighter' ? 32 : 18));
  return JSON.stringify({ p, c, w, b });
}

route('POST', /^\/api\/stickers$/, async ({ req, user }) => {
  requirePoster(user);
  const body = await readJson(req, 200 * 1024);
  let kind;
  let content;
  let screen = null;
  if (body.kind === 'line') {
    rateLimit(`line:${user.id}`, 30, 60_000, 'Lots of drawing! Give it a moment.');
    content = cleanLine(body.content);
    kind = 'line';
  } else if (body.kind === 'word') {
    rateLimit(`word:${user.id}`, 60, 60_000, 'Lots of words! Give it a moment.');
    const word = String(body.content || '').trim();
    if (!isBankWord(word)) {
      const verdict = checkTile(word);
      if (!verdict.ok) throw new HttpError(422, verdict.reason, { moderation: true });
    }
    kind = 'word';
    content = JSON.stringify({
      t: word, s: TILE_STYLES.includes(body.style) ? body.style : 'clipping', f: TILE_FONTS.includes(body.font) ? body.font : 'auto',
    });
  } else {
    rateLimit(`sticker:${user.id}`, 15, 60_000, 'That’s a lot of stickers! Give it a moment.');
    // a doodle is "name" (paper sticker) or "name:magnet" (glossy fridge magnet)
    const [doodleName, doodleStyle] = String(body.content || '').split(':');
    if (body.kind === 'doodle' && DOODLES.includes(doodleName) && (!doodleStyle || doodleStyle === 'magnet')) {
      kind = 'doodle';
      content = doodleStyle ? `${doodleName}:magnet` : doodleName;
    } else if (body.kind === 'emoji' && typeof body.content === 'string' && [...body.content].length <= 4 && !/[\p{L}\p{N}<>]/u.test(body.content)) {
      kind = 'emoji';
      content = body.content;
    } else if ((body.kind === 'image' || body.kind === 'magnet') && typeof body.mine === 'string') {
      const mine = (await dbGet('SELECT * FROM my_stickers WHERE id = ? AND user_id = ?', body.mine, user.id));
      if (!mine) throw new HttpError(404, 'Sticker not found in your collection.');
      kind = body.kind; // 'magnet' = their drawing in a glossy fridge-magnet frame
      content = mine.data;
      screen = mine.screen;
    } else {
      throw new HttpError(400, 'Unknown sticker.');
    }
  }
  const id = randomUUID();
  const size = kind === 'word' || kind === 'line' ? 0 : clamp(body.size || 72, 40, 160);
  await guardClearNotes(user, today(), stickerBox(kind, content, posX(body.x, 60), posY(body.y, 40), size));
  const hidden = kind === 'image' || kind === 'magnet' ? PENDING : 0; // hand-made pictures always get a human look
  (await dbRun('INSERT INTO stickers (id, day, user_id, kind, content, x, y, size, rot, hidden, screen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, today(), user.id, kind, content, posX(body.x, 60), posY(body.y, 40), size, kind === 'line' ? 0 : kind === 'word' ? jitter(2.5) : jitter(10), hidden, screen, now()));
  const sticker = stickerOut((await dbGet('SELECT * FROM stickers WHERE id = ?', id)));
  emit('sticker', sticker, { hidden, user_id: user.id });
  return { sticker: forViewer(sticker, user.id), pending: hidden === PENDING ? 'it\u2019s hand-made' : null };
});

// Some writers ask for their note to stay clear of other people's doodles, stickers and words.
// A note's footprint is estimated from its size class (matching the board's layout) plus a margin.
const NOTE_BOX = { s: [220, 230], m: [250, 270], l: [290, 330] };
const noteSizeOf = (text) => (text.length < 70 ? 's' : text.length < 200 ? 'm' : 'l');
function stickerBox(kind, content, x, y, size) {
  if (kind === 'line') {
    const { p } = JSON.parse(content);
    return [x, y, x + Math.max(...p.map((q) => q[0])), y + Math.max(...p.map((q) => q[1]))];
  }
  if (kind === 'word') {
    const t = content.startsWith('{') ? JSON.parse(content).t : content;
    return [x, y, x + t.length * 13 + 24, y + 34];
  }
  return [x, y, x + size, y + size];
}
async function guardClearNotes(user, day, box) {
  const notes = await dbAll('SELECT x, y, text, user_id FROM notes WHERE day = ? AND hidden = 0 AND keep_clear = 1 AND user_id != ?', day, user.id);
  for (const n of notes) {
    const [w, hgt] = NOTE_BOX[noteSizeOf(n.text)];
    const pad = 6;
    if (box[0] < n.x + w + pad && box[2] > n.x - pad && box[1] < n.y + hgt + pad && box[3] > n.y - pad) {
      throw new HttpError(409, 'That note\u2019s writer asked to keep it clear. Try a spot beside it?', { keepClear: true });
    }
  }
}

route('PATCH', /^\/api\/stickers\/([\w-]+)$/, async ({ req, user, params }) => {
  requirePoster(user);
  const row = (await ownedRow('sticker', params[0], user));
  requireToday(row.day);
  const body = await readJson(req);
  await guardClearNotes(user, row.day, stickerBox(row.kind, row.content, posX(body.x, 60), posY(body.y, 40), row.size));
  (await dbRun('UPDATE stickers SET x = ?, y = ? WHERE id = ?', posX(body.x, 60), posY(body.y, 40), row.id));
  const sticker = stickerOut((await dbGet('SELECT * FROM stickers WHERE id = ?', row.id)));
  emit('sticker', sticker, row);
  return { sticker: forViewer(sticker, user.id) };
});

route('DELETE', /^\/api\/(note|reply|sticker)s?\/([\w-]+)$/, async ({ user, params }) => {
  requireUser(user);
  const [type, id] = [params[0], params[1]];
  const row = (await ownedRow(type, id, user));
  requireToday((await dayOf(type, row)));
  (await dbRun(`UPDATE ${TABLES[type]} SET hidden = 2 WHERE id = ?`, id));
  (await broadcastRemoval(type, id));
  if (type === 'reply') broadcast('note', (await getNote(row.note_id)));
  return { ok: true };
});

// Personal sticker collection (drawn or uploaded, stored as small PNGs).
route('GET', /^\/api\/my-stickers$/, async ({ user }) => {
  requireUser(user);
  return { stickers: (await dbAll('SELECT id, data FROM my_stickers WHERE user_id = ? ORDER BY created_at DESC', user.id)) };
});
// Automatic image check for hand-made stickers (optional). Google Cloud Vision's SafeSearch rates how
// likely an image is to be adult, violent, racy or gory. Clearly inappropriate images are refused;
// everything else still waits for a moderator, labelled with the result. Returns 'safe' | 'unsure' | null.
const RISKY = new Set(['LIKELY', 'VERY_LIKELY']);
async function screenImage(dataUrl) {
  if (!CONFIG.visionKey) return null; // not configured: a human still reviews every hand-made sticker
  try {
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(CONFIG.visionKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: dataUrl.split(',')[1] }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] }),
    });
    const ss = (await res.json()).responses?.[0]?.safeSearchAnnotation;
    if (!ss) return 'unsure';
    if (RISKY.has(ss.adult) || RISKY.has(ss.violence) || RISKY.has(ss.racy)) return 'blocked';
    return ss.adult === 'POSSIBLE' || ss.violence === 'POSSIBLE' || ss.racy === 'POSSIBLE' ? 'unsure' : 'safe';
  } catch {
    return 'unsure';
  }
}

route('POST', /^\/api\/my-stickers$/, async ({ req, user }) => {
  requirePoster(user);
  const { data } = await readJson(req, 220 * 1024);
  if (!validPng(data)) throw new HttpError(400, 'Stickers must be small PNG images (under 150 KB).');
  const count = (await dbGet('SELECT COUNT(*) AS c FROM my_stickers WHERE user_id = ?', user.id)).c;
  if (count >= 40) throw new HttpError(400, 'Your collection is full (40 stickers). Remove one to add another.');
  rateLimit(`mysticker:${user.id}`, 10, 600_000);
  const screen = await screenImage(data);
  if (screen === 'blocked') throw new HttpError(422, 'This image can\u2019t be used on Kindboard. Try drawing something else?', { moderation: true });
  const id = randomUUID();
  (await dbRun('INSERT INTO my_stickers (id, user_id, data, screen, created_at) VALUES (?, ?, ?, ?, ?)', id, user.id, data, screen, now()));
  return { sticker: { id, data } };
});
route('DELETE', /^\/api\/my-stickers\/([\w-]+)$/, async ({ user, params }) => {
  requireUser(user);
  (await dbRun('DELETE FROM my_stickers WHERE id = ? AND user_id = ?', params[0], user.id));
  return { ok: true };
});

// Reports: a quiet backstop for anything the automatic checks miss. Reports never give
// strikes; enough of them send the post back for a moderator to review.
const FLAG_REASONS = ['hurtful', 'harassment', 'hate', 'self-harm', 'spam', 'inappropriate', 'other'];
route('POST', /^\/api\/flag$/, async ({ req, user }) => {
  requireUser(user);
  const { type, id, reason } = await readJson(req);
  if (!TABLES[type]) throw new HttpError(400, 'Unknown item.');
  const row = (await dbGet(`SELECT * FROM ${TABLES[type]} WHERE id = ?`, id));
  if (!row || row.hidden) throw new HttpError(404, 'That is no longer on the board.');
  if (row.user_id === user.id) throw new HttpError(400, 'You can’t flag your own post, but you can delete it.');
  rateLimit(`flag:${user.id}`, 30, 3_600_000);
  (await dbRun('INSERT OR IGNORE INTO flags (target_type, target_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)', type, id, user.id, FLAG_REASONS.includes(reason) ? reason : 'other', now(),));
  // Banned identities can still flag, but only active identities count toward auto-hiding.
  const { c } = (await dbGet(`SELECT COUNT(*) AS c FROM flags f JOIN users u ON u.id = f.user_id
                   WHERE f.target_type = ? AND f.target_id = ? AND u.banned = 0`, type, id));
  if (c >= CONFIG.flagsToHide) {
    (await dbRun(`UPDATE ${TABLES[type]} SET hidden = ? WHERE id = ?`, PENDING, id));
    (await broadcastRemoval(type, id));
  }
  return { ok: true };
});

// ---- moderator endpoints (x-admin-key header)
function requireAdmin(req) {
  const key = String(req.headers['x-admin-key'] || '');
  if (!CONFIG.adminKey || !timingSafeEqual(Buffer.from(sha(key)), Buffer.from(sha(CONFIG.adminKey)))) {
    rateLimit(`admin:${ipHash(req)}`, 10, 900_000, 'Too many attempts.');
    throw new HttpError(401, 'Wrong moderator key.');
  }
}
async function adminItem(type, id, flagInfo) {
  const row = (await dbGet(`SELECT t.*, u.handle, u.strikes, u.banned FROM ${TABLES[type]} t JOIN users u ON u.id = t.user_id WHERE t.id = ?`, id));
  if (!row) return null;
  return {
    type, id, flags: flagInfo?.c || 0, reasons: flagInfo ? flagInfo.reasons.split(',') : [], when: flagInfo?.last || row.created_at,
    screen: row.screen ?? null,
    text: row.text ?? null, kind: row.kind ?? null, content: row.content ?? null, day: (await dayOf(type, row)), why: row.text ? checkText(row.text).hold : null,
    hidden: row.hidden, pending: row.hidden === PENDING, struck: !!row.struck, author: row.handle, authorStrikes: row.strikes, authorBanned: !!row.banned,
  };
}
route('GET', /^\/api\/admin\/flags$/, async ({ req }) => {
  requireAdmin(req);
  const seen = new Set();
  const items = [];
  const flagged = new Map((await dbAll(`SELECT target_type, target_id, COUNT(*) AS c, GROUP_CONCAT(DISTINCT reason) AS reasons, MAX(created_at) AS last
                             FROM flags GROUP BY target_type, target_id`)).map((g) => [`${g.target_type}:${g.target_id}`, g]));
  // Waiting for approval first, oldest first, so nobody waits too long.
  for (const [type, table] of Object.entries(TABLES)) {
    for (const r of (await dbAll(`SELECT id FROM ${table} WHERE hidden = ? ORDER BY created_at LIMIT 200`, PENDING))) {
      seen.add(`${type}:${r.id}`);
      items.push((await adminItem(type, r.id, flagged.get(`${type}:${r.id}`))));
    }
  }
  for (const [key, g] of [...flagged].sort((x, y) => y[1].last - x[1].last).slice(0, 200)) {
    if (!seen.has(key)) items.push((await adminItem(g.target_type, g.target_id, g)));
  }
  return { items: items.filter(Boolean) };
});
route('POST', /^\/api\/admin\/resolve$/, async ({ req }) => {
  requireAdmin(req);
  const { type, id, action } = await readJson(req);
  if (!TABLES[type]) throw new HttpError(400, 'Unknown item.');
  const row = (await dbGet(`SELECT * FROM ${TABLES[type]} WHERE id = ?`, id));
  if (!row) throw new HttpError(404, 'Not found.');
  const clearFlags = async () => (await dbRun('DELETE FROM flags WHERE target_type = ? AND target_id = ?', type, id));
  if (action === 'approve' || action === 'restore') {
    (await dbRun(`UPDATE ${TABLES[type]} SET hidden = 0, struck = 0 WHERE id = ?`, id));
    (await clearFlags());
    if (row.struck) (await removeStrike(row.user_id));
    // Now everyone can see it.
    if (type === 'note') broadcast('note', (await getNote(id)));
    if (type === 'sticker') broadcast('sticker', stickerOut((await dbGet('SELECT * FROM stickers WHERE id = ?', id))));
    if (type === 'reply') {
      const note = (await dbGet('SELECT day FROM notes WHERE id = ?', row.note_id));
      broadcast('reply', { ...replyOut((await dbGet(`${REPLY_SQL} WHERE r.id = ?`, id))), day: note?.day });
      broadcast('note', (await getNote(row.note_id)));
    }
  } else if (action === 'decline') {
    (await dbRun(`UPDATE ${TABLES[type]} SET hidden = 1 WHERE id = ?`, id));
    (await clearFlags());
    sendTo(row.user_id, 'removed', { type, id, declined: true });
    (await broadcastRemoval(type, id));
  } else if (action === 'remove') {
    (await hideForModeration(type, id));
    (await clearFlags());
  } else if (action === 'dismiss') {
    (await clearFlags());
  } else {
    throw new HttpError(400, 'Unknown action.');
  }
  return { ok: true };
});

// ---------------------------------------------------------------- static files

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
// Client-side pages, all served by the single-page app.
const APP_PAGES = /^\/(?:|welcome|login|calendar|day\/\d{4}-\d{2}-\d{2}\/?)$/;

async function serveStatic(req, res, pathname) {
  if (APP_PAGES.test(pathname)) pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  try {
    const s = await stat(file);
    if (!s.isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}

const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "connect-src 'self' https://api.open-meteo.com", // optional local weather for the garden sky
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(self)', // geolocation only for opt-in weather
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (isHttps(req)) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname === '/api/stream' && req.method === 'GET') return openStream(req, res, requireUser((await sessionUser(req))));
    if (url.pathname === '/auth/google/start' && req.method === 'GET') return await googleStart(req, res, url);
    if (url.pathname === '/auth/google/callback' && req.method === 'GET') return await googleCallback(req, res, url);
    if (url.pathname.startsWith('/api/')) {
      checkCsrf(req);
      const user = (await sessionUser(req));
      if (user?.banned) markDevice(req, res);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.pattern);
        if (!m) continue;
        const result = await r.handler({ req, res, url, user, params: m.slice(1) });
        return sendJson(res, 200, result);
      }
      throw new HttpError(404, 'Not found.');
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, url.pathname))) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.extra?.paused) markDevice(req, res);
      return sendJson(res, err.status, { error: err.message, ...err.extra });
    }
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong on our side.' });
  }
});

// A friendly first note on a fresh board, so nobody arrives to an empty room.
async function seedWelcome() {
  if ((await dbGet('SELECT COUNT(*) AS c FROM notes')).c > 0) return;
  if (!(await dbGet("SELECT 1 FROM users WHERE id = 'system'"))) {
    // Unusable passphrase hash: nobody can log in as the board itself.
    (await dbRun("INSERT INTO users (id, handle, pass_hash, animal, color, created_at) VALUES ('system', 'board-0000', '!', 'Board', '#57534e', ?)", now()));
  }
  (await dbRun('INSERT INTO notes (id, day, user_id, text, color, x, y, rot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), today(), 'system',
    'Welcome.\n\nThis is a board for anyone who wants someone to talk to. Pin a thought, a worry, a small win. There’s no word limit. Someone will write back.\n\nYou’re anonymous here. Be kind, always.',
    'butter', CONFIG.boardW / 2 - 130, CONFIG.boardH / 2 - 140, -0.6, now(),));
}
await setupDatabase();
await seedWelcome();
// Give everyone who signed up before animal characters existed their own version.
for (const u of await dbAll("SELECT id, animal FROM users WHERE variant IS NULL AND id != 'system'")) {
  await dbRun('UPDATE users SET variant = ? WHERE id = ?', await assignVariant(u.animal), u.id);
}

server.listen(CONFIG.port, () => {
  console.log(`[kindboard] listening on http://localhost:${CONFIG.port}  (boards roll over at midnight ${CONFIG.timeZone})`);
});
