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
import { DatabaseSync } from 'node:sqlite';
import { checkText, checkTile } from './moderation.js';
import { quoteFor, quotesFor, wordsFor, isBankWord, DOODLES } from './content.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const scryptAsync = promisify(scrypt);

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(ROOT, 'kindboard.db'),
  adminKey: process.env.ADMIN_KEY || '',
  ipSalt: process.env.IP_SALT || 'change-me-in-production',
  timeZone: process.env.BOARD_TZ || 'UTC', // when "today" rolls over
  trustProxy: process.env.TRUST_PROXY === '1', // behind Render/Fly/Nginx etc.
  cookieSecure: process.env.COOKIE_SECURE === '1' ? true : process.env.COOKIE_SECURE === '0' ? false : null, // null = auto
  flagsToHide: Number(process.env.FLAGS_TO_HIDE) || 3, // distinct reports → back to moderator review
  strikesToBan: 2,
  ipBanDays: 7,
  sessionDays: 30,
  maxText: 20000, // "no word limit" in practice — this only stops abuse
  boardW: 4000,
  boardH: 3000,
};

if (!process.env.IP_SALT) console.warn('[kindboard] IP_SALT not set. Set it in production.');
if (!CONFIG.adminKey) console.warn('[kindboard] ADMIN_KEY not set, so the moderation page is disabled.');

// ---------------------------------------------------------------- database

const db = new DatabaseSync(CONFIG.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
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
`);
// Later additions to the notes table (safe to run on existing databases).
{
  const cols = new Set(db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name));
  if (!cols.has('paper')) db.exec("ALTER TABLE notes ADD COLUMN paper TEXT NOT NULL DEFAULT 'plain'");
  if (!cols.has('fastener')) db.exec("ALTER TABLE notes ADD COLUMN fastener TEXT NOT NULL DEFAULT 'pin'");
  const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!userCols.has('look')) db.exec('ALTER TABLE users ADD COLUMN look TEXT'); // their pixel character, as JSON
}

const q = (sql) => db.prepare(sql);
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
setInterval(() => {
  const t = now();
  for (const [k, list] of buckets) if (list.every((h) => t - h > 3_600_000)) buckets.delete(k);
  q('DELETE FROM sessions WHERE expires_at < ?').run(t);
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
function setSessionCookie(req, res, token, remember) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', ...(isHttps(req) ? ['Secure'] : [])];
  if (remember) attrs.push(`Max-Age=${CONFIG.sessionDays * 86400}`);
  res.setHeader('set-cookie', `kb_session=${token}; ${attrs.join('; ')}`);
}
function clearSessionCookie(req, res) {
  res.setHeader('set-cookie', `kb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}
function startSession(req, res, userId, remember) {
  const token = randomBytes(32).toString('base64url');
  const ttl = remember ? CONFIG.sessionDays * 86_400_000 : 86_400_000; // non-remembered: 1 day max
  q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha(token), userId, now(), now() + ttl);
  setSessionCookie(req, res, token, remember);
}
function sessionUser(req) {
  const token = parseCookies(req).kb_session;
  if (!token || token.length > 100) return null;
  const row = q(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha(token), now());
  return row || null;
}

const displayName = (u) => `Anonymous ${u.animal}`;
// A pixel character: hairstyle + indexes into the client's colour lists.
const HAIRSTYLES = ['bowl', 'short', 'curly', 'long', 'bun'];
function cleanLook(raw) {
  const n = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  return { style: HAIRSTYLES.includes(raw?.style) ? raw.style : 'short', skin: n(raw?.skin, 4), hair: n(raw?.hair, 5), suit: n(raw?.suit, 7) };
}
function readLook(u) {
  try { return u.look ? cleanLook(JSON.parse(u.look)) : null; } catch { return null; }
}

function publicMe(u) {
  return {
    look: readLook(u),
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
function moderate(text, user) {
  const result = checkText(text);
  if (!result.ok) {
    let message = result.reason;
    if (result.severe && user) {
      addStrike(user.id);
      const u = q('SELECT strikes, banned FROM users WHERE id = ?').get(user.id);
      message += u.banned
        ? ' That was a second strike, so this identity is now paused. You can still read.'
        : ` This counts as a strike (${u.strikes} of ${CONFIG.strikesToBan}).`;
    }
    throw new HttpError(422, message, { moderation: true, strike: !!result.severe });
  }
  return { support: result.support, hold: result.hold };
}

// Send an item to everyone, or only to its author while it waits for approval.
function emit(event, item, row) {
  if (row.hidden === PENDING) sendTo(row.user_id, event, forViewer(item, row.user_id));
  else broadcast(event, item);
}

function addStrike(userId) {
  const u = q('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return;
  const strikes = u.strikes + 1;
  const banned = strikes >= CONFIG.strikesToBan ? 1 : 0;
  q('UPDATE users SET strikes = ?, banned = ? WHERE id = ?').run(strikes, banned, userId);
  if (banned && !u.banned) {
    if (u.ip_hash) {
      q('INSERT OR REPLACE INTO banned_ips (ip_hash, until) VALUES (?, ?)').run(u.ip_hash, now() + CONFIG.ipBanDays * 86_400_000);
    }
    // A banned identity's content leaves the board.
    for (const [type, table] of Object.entries(TABLES)) {
      for (const row of q(`SELECT id FROM ${table} WHERE user_id = ? AND hidden = 0`).all(userId)) {
        q(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(row.id);
        broadcastRemoval(type, row.id);
      }
    }
  }
  sendTo(userId, 'me', publicMe({ ...u, strikes, banned }));
}

function removeStrike(userId) {
  const u = q('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return;
  const strikes = Math.max(0, u.strikes - 1);
  const banned = strikes >= CONFIG.strikesToBan ? 1 : 0;
  q('UPDATE users SET strikes = ?, banned = ? WHERE id = ?').run(strikes, banned, userId);
  if (!banned && u.banned && u.ip_hash) q('DELETE FROM banned_ips WHERE ip_hash = ?').run(u.ip_hash);
  sendTo(userId, 'me', publicMe({ ...u, strikes, banned }));
}

function hideForModeration(type, id) {
  const table = TABLES[type];
  const row = q(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return;
  q(`UPDATE ${table} SET hidden = 1, struck = 1 WHERE id = ?`).run(id);
  if (row.hidden === 0) broadcastRemoval(type, id);
  if (!row.struck) addStrike(row.user_id);
}

// ---------------------------------------------------------------- serializers

const NOTE_SQL = `
  SELECT n.*, u.animal, u.color AS avatar,
    (SELECT COUNT(*) FROM replies r WHERE r.note_id = n.id AND r.hidden = 0) AS reply_count
  FROM notes n JOIN users u ON u.id = n.user_id`;
const REPLY_SQL = `SELECT r.*, u.animal, u.color AS avatar FROM replies r JOIN users u ON u.id = r.user_id`;

const noteOut = (r) => ({
  id: r.id, day: r.day, text: r.text, color: r.color, paper: r.paper, fastener: r.fastener, x: r.x, y: r.y, rot: r.rot, pending: r.hidden === PENDING,
  name: `Anonymous ${r.animal}`, animal: r.animal, avatar: r.avatar, createdAt: r.created_at, replyCount: r.reply_count, userId: r.user_id,
});
const replyOut = (r) => ({
  id: r.id, noteId: r.note_id, text: r.text, pending: r.hidden === PENDING, name: `Anonymous ${r.animal}`, animal: r.animal, avatar: r.avatar, createdAt: r.created_at, userId: r.user_id,
});
const stickerOut = (r) => ({
  id: r.id, day: r.day, kind: r.kind, content: r.content, pending: r.hidden === PENDING, x: r.x, y: r.y, size: r.size, rot: r.rot, userId: r.user_id,
});
// Never expose internal user ids: replace them with a per-viewer "mine" flag.
const forViewer = (item, viewerId) => {
  const { userId, ...rest } = item;
  return { ...rest, mine: !!viewerId && userId === viewerId };
};
const getNote = (id) => {
  const r = q(`${NOTE_SQL} WHERE n.id = ?`).get(id);
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
function broadcastRemoval(type, id) {
  const extra = type === 'reply' ? { noteId: q('SELECT note_id FROM replies WHERE id = ?').get(id)?.note_id } : {};
  broadcast('removed', { type, id, ...extra });
}
let presenceTimer;
function broadcastPresence() {
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => broadcast('presence', { online: clients.size }), 300);
}
setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 25_000).unref();

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

function ownedRow(type, id, user) {
  const row = q(`SELECT * FROM ${TABLES[type]} WHERE id = ? AND hidden IN (0, ${PENDING})`).get(id);
  if (!row) throw new HttpError(404, 'That is no longer on the board.');
  if (row.user_id !== user.id) throw new HttpError(403, 'You can only change your own things.');
  return row;
}
const dayOf = (type, row) => (type === 'reply' ? q('SELECT day FROM notes WHERE id = ?').get(row.note_id)?.day : row.day);

// ---------------------------------------------------------------- routes

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// Public: the landing page needs only these.
route('GET', /^\/api\/config$/, () => ({
  today: today(), timeZone: CONFIG.timeZone, boardW: CONFIG.boardW, boardH: CONFIG.boardH,
  noteColors: NOTE_COLORS, lineColors: LINE_COLORS, papers: PAPERS, fasteners: FASTENERS, strikesToBan: CONFIG.strikesToBan, flagsToHide: CONFIG.flagsToHide, animals: ANIMALS,
}));
route('GET', /^\/api\/quote$/, () => {
  const day = today();
  const stats = q(`SELECT COUNT(*) AS notes FROM notes WHERE day = ? AND hidden = 0`).get(day);
  const replies = q(`SELECT COUNT(*) AS c FROM replies r JOIN notes n ON n.id = r.note_id WHERE n.day = ? AND r.hidden = 0`).get(day);
  return { day, quote: quoteFor(day), quotes: quotesFor(day), notes: stats.notes, replies: replies.c, online: clients.size };
});

route('POST', /^\/api\/signup$/, async ({ req, res }) => {
  const ip = ipHash(req);
  if (hits(`signup:${ip}`, 3_600_000).length >= 10) throw new HttpError(429, 'Too many new identities from here. Try again later.');
  const ban = q('SELECT until FROM banned_ips WHERE ip_hash = ?').get(ip);
  if (ban && ban.until > now()) throw new HttpError(403, 'New identities are paused from this network for a little while.', { banned: true });
  const body = await readJson(req);
  const animal = ANIMALS.includes(body.animal) ? body.animal : pick(ANIMALS);
  let handle;
  for (let i = 0; i < 20 && !handle; i++) {
    const candidate = `${animal.toLowerCase()}-${randomInt(1000, 10000)}`;
    if (!q('SELECT 1 FROM users WHERE handle = ?').get(candidate)) handle = candidate;
  }
  if (!handle) throw new HttpError(503, 'Please try again.');
  const problem = passphraseProblem(body.passphrase, handle);
  if (problem) throw new HttpError(400, problem, { field: 'passphrase' });
  hits(`signup:${ip}`, 3_600_000).push(now()); // only real sign-ups count toward the limit
  const id = randomUUID();
  q('INSERT INTO users (id, handle, pass_hash, animal, color, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, handle, await hashPassphrase(body.passphrase), animal, pick(AVATAR_COLORS), ip, now(),
  );
  startSession(req, res, id, !!body.remember);
  return { me: publicMe(q('SELECT * FROM users WHERE id = ?').get(id)) };
});

route('POST', /^\/api\/login$/, async ({ req, res }) => {
  const ip = ipHash(req);
  const body = await readJson(req);
  const handle = String(body.handle || '').trim().toLowerCase().replace(/\s+/g, '-');
  rateLimit(`login-ip:${ip}`, 20, 900_000, 'Too many attempts. Wait a few minutes.');
  // Per-handle lockout stops slow, distributed guessing against one identity.
  if (hits(`login-fail:${handle}`, 900_000).length >= 8) throw new HttpError(429, 'This handle is locked for 15 minutes after too many attempts.');
  const user = /^[a-z]+-\d{4}$/.test(handle) ? q('SELECT * FROM users WHERE handle = ?').get(handle) : null;
  const ok = await verifyPassphrase(body.passphrase, user?.pass_hash);
  if (!user || !ok) {
    hits(`login-fail:${handle}`, 900_000).push(now());
    throw new HttpError(401, 'That handle and password don’t match.');
  }
  startSession(req, res, user.id, !!body.remember);
  return { me: publicMe(user) };
});

route('POST', /^\/api\/logout$/, ({ req, res }) => {
  const token = parseCookies(req).kb_session;
  if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  clearSessionCookie(req, res);
  return { ok: true };
});

route('POST', /^\/api\/logout-everywhere$/, ({ req, res, user }) => {
  requireUser(user);
  q('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  clearSessionCookie(req, res);
  return { ok: true };
});

route('GET', /^\/api\/me$/, ({ user }) => ({ me: user ? publicMe(user) : null }));

route('PUT', /^\/api\/me\/look$/, async ({ req, user }) => {
  requireUser(user);
  rateLimit(`look:${user.id}`, 30, 600_000);
  const look = cleanLook(await readJson(req, 1024));
  q('UPDATE users SET look = ? WHERE id = ?').run(JSON.stringify(look), user.id);
  return { me: publicMe({ ...user, look: JSON.stringify(look) }) };
});

route('GET', /^\/api\/board$/, ({ url, user }) => {
  requireUser(user);
  const day = url.searchParams.get('day') || today();
  if (!isDay(day)) throw new HttpError(400, 'Invalid date.');
  if (day > today()) throw new HttpError(404, 'That day hasn’t happened yet.');
  const notes = q(`${NOTE_SQL} WHERE n.day = ? AND ${visibleTo('n.')} ORDER BY n.created_at`).all(day, user.id).map(noteOut);
  const stickers = q(`SELECT * FROM stickers WHERE day = ? AND ${visibleTo()} ORDER BY created_at`).all(day, user.id).map(stickerOut);
  return {
    day, today: today(), archived: day !== today(), quote: quoteFor(day),
    notes: notes.map((n) => forViewer(n, user.id)),
    stickers: stickers.map((s) => forViewer(s, user.id)),
  };
});

route('GET', /^\/api\/calendar$/, ({ url, user }) => {
  requireUser(user);
  const month = url.searchParams.get('month') || today().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Invalid month.');
  const days = {};
  for (const r of q(`SELECT day, COUNT(*) AS c, GROUP_CONCAT(color) AS colors FROM notes WHERE day LIKE ? AND hidden = 0 GROUP BY day`).all(`${month}-%`)) {
    days[r.day] = { notes: r.c, replies: 0, colors: r.colors.split(',').slice(0, 8), preview: null };
  }
  for (const r of q(`SELECT n.day, COUNT(*) AS c FROM replies r JOIN notes n ON n.id = r.note_id
                     WHERE n.day LIKE ? AND r.hidden = 0 AND n.hidden = 0 GROUP BY n.day`).all(`${month}-%`)) {
    if (days[r.day]) days[r.day].replies = r.c;
  }
  // A short line from the most-replied note of each day, for the calendar preview.
  for (const day of Object.keys(days)) {
    const top = q(`${NOTE_SQL} WHERE n.day = ? AND n.hidden = 0 ORDER BY reply_count DESC, n.created_at LIMIT 1`).get(day);
    if (top) days[day].preview = top.text.slice(0, 90);
  }
  return { month, today: today(), days };
});

route('GET', /^\/api\/words$/, ({ url, user }) => {
  requireUser(user);
  const day = url.searchParams.get('day') || today();
  return wordsFor(isDay(day) ? day : today());
});

route('POST', /^\/api\/notes$/, async ({ req, user }) => {
  requirePoster(user);
  const body = await readJson(req);
  const day = today();
  const text = cleanText(body.text);
  const { support, hold } = moderate(text, user);
  rateLimit(`note:${user.id}`, 4, 60_000, 'You’ve pinned a few notes quickly. Take a breath and try again in a minute.');
  const color = NOTE_COLORS.includes(body.color) ? body.color : 'butter';
  const paper = PAPERS.includes(body.paper) ? body.paper : 'plain';
  const fastener = FASTENERS.includes(body.fastener) ? body.fastener : 'pin';
  const id = randomUUID();
  q('INSERT INTO notes (id, day, user_id, text, color, paper, fastener, x, y, rot, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, day, user.id, text, color, paper, fastener, posX(body.x, 260), posY(body.y, 200), jitter(4), hold ? PENDING : 0, now(),
  );
  const note = getNote(id);
  emit('note', note, { hidden: hold ? PENDING : 0, user_id: user.id });
  return { note: forViewer(note, user.id), support, pending: hold };
});

route('POST', /^\/api\/notes\/check$/, async ({ req, user }) => {
  requirePoster(user);
  requireToday(today());
  const { hold } = moderate(cleanText((await readJson(req)).text), user);
  return { ok: true, pending: hold };
});

// Live cursors: where other people are on today's board. Ephemeral — never stored.
const cursorTag = (userId, day) => sha(`${CONFIG.ipSalt}:cursor:${userId}:${day}`).slice(0, 12);
route('POST', /^\/api\/cursor$/, async ({ req, user }) => {
  requireUser(user);
  const body = await readJson(req, 512);
  if (!isDay(body.day) || body.day > today()) throw new HttpError(400, 'Invalid day.');
  if (hits(`cursor:${user.id}`, 1000).length >= 12) return { ok: true }; // silently drop floods
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
  const row = q(`SELECT * FROM notes WHERE id = ? AND ${visibleTo()}`).get(params[0], user.id);
  if (!row) throw new HttpError(404, 'That is no longer on the board.');
  rateLimit(`move:${user.id}`, 90, 60_000, 'Lots of rearranging! Give it a moment.');
  requireToday(row.day);
  const body = await readJson(req);
  q('UPDATE notes SET x = ?, y = ? WHERE id = ?').run(posX(body.x, 260), posY(body.y, 200), row.id);
  const note = getNote(row.id);
  emit('note', note, row);
  return { note: forViewer(note, user.id) };
});

route('GET', /^\/api\/notes\/([\w-]+)$/, ({ user, params }) => {
  requireUser(user);
  const r = q(`${NOTE_SQL} WHERE n.id = ? AND ${visibleTo('n.')}`).get(params[0], user.id);
  if (!r) throw new HttpError(404, 'This note is no longer on the board.');
  const replies = q(`${REPLY_SQL} WHERE r.note_id = ? AND ${visibleTo('r.')} ORDER BY r.created_at`).all(params[0], user.id).map(replyOut);
  return { note: forViewer(noteOut(r), user.id), replies: replies.map((x) => forViewer(x, user.id)), archived: r.day !== today() };
});

route('POST', /^\/api\/notes\/([\w-]+)\/replies$/, async ({ req, user, params }) => {
  requirePoster(user);
  const note = q('SELECT * FROM notes WHERE id = ? AND hidden IN (0, ?)').get(params[0], PENDING);
  if (!note || (note.hidden === PENDING && note.user_id !== user.id)) throw new HttpError(404, 'This note is no longer on the board.');
  if (note.hidden === PENDING) throw new HttpError(403, 'Replies open once this note is approved.');
  requireToday(note.day);
  const text = cleanText((await readJson(req)).text);
  const { support, hold } = moderate(text, user);
  rateLimit(`reply:${user.id}`, 10, 60_000);
  const id = randomUUID();
  q('INSERT INTO replies (id, note_id, user_id, text, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, note.id, user.id, text, hold ? PENDING : 0, now());
  const reply = replyOut(q(`${REPLY_SQL} WHERE r.id = ?`).get(id));
  emit('reply', { ...reply, day: note.day }, { hidden: hold ? PENDING : 0, user_id: user.id });
  if (!hold) broadcast('note', getNote(note.id)); // refresh reply count
  return { reply: forViewer(reply, user.id), support, pending: hold };
});

// A squiggly line: points relative to its top-left corner, plus colour and thickness.
const LINE_COLORS = ['#161513', '#8f3f1c', '#c2410c', '#ca8a04', '#3f7d3a', '#0f766e', '#2b6cb0', '#6d65d8', '#be185d', '#ffffff'];
function cleanLine(raw) {
  const pts = Array.isArray(raw?.p) ? raw.p : [];
  if (pts.length < 2 || pts.length > 600) throw new HttpError(400, 'That line is too short or too long.');
  const p = pts.map((pt) => {
    if (!Array.isArray(pt) || pt.length !== 2) throw new HttpError(400, 'Invalid line.');
    return [Math.round(clamp(pt[0], 0, 3000)), Math.round(clamp(pt[1], 0, 3000))];
  });
  const c = LINE_COLORS.includes(raw.c) ? raw.c : LINE_COLORS[0];
  const w = Math.round(clamp(raw.w, 2, 14));
  return JSON.stringify({ p, c, w });
}

route('POST', /^\/api\/stickers$/, async ({ req, user }) => {
  requirePoster(user);
  const body = await readJson(req, 200 * 1024);
  let kind;
  let content;
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
    content = word;
  } else {
    rateLimit(`sticker:${user.id}`, 15, 60_000, 'That’s a lot of stickers! Give it a moment.');
    if (body.kind === 'doodle' && DOODLES.includes(body.content)) {
      kind = 'doodle';
      content = body.content;
    } else if (body.kind === 'emoji' && typeof body.content === 'string' && [...body.content].length <= 4 && !/[\p{L}\p{N}<>]/u.test(body.content)) {
      kind = 'emoji';
      content = body.content;
    } else if (body.kind === 'image' && typeof body.mine === 'string') {
      const mine = q('SELECT * FROM my_stickers WHERE id = ? AND user_id = ?').get(body.mine, user.id);
      if (!mine) throw new HttpError(404, 'Sticker not found in your collection.');
      kind = 'image';
      content = mine.data;
    } else {
      throw new HttpError(400, 'Unknown sticker.');
    }
  }
  const id = randomUUID();
  const size = kind === 'word' || kind === 'line' ? 0 : clamp(body.size || 72, 40, 160);
  const hidden = kind === 'image' ? PENDING : 0;
  q('INSERT INTO stickers (id, day, user_id, kind, content, x, y, size, rot, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, today(), user.id, kind, content, posX(body.x, 60), posY(body.y, 40), size, kind === 'line' ? 0 : kind === 'word' ? jitter(2.5) : jitter(10), hidden, now(),
  );
  const sticker = stickerOut(q('SELECT * FROM stickers WHERE id = ?').get(id));
  emit('sticker', sticker, { hidden, user_id: user.id });
  return { sticker: forViewer(sticker, user.id), pending: hidden === PENDING ? 'it\u2019s a hand-made sticker' : null };
});

route('PATCH', /^\/api\/stickers\/([\w-]+)$/, async ({ req, user, params }) => {
  requirePoster(user);
  const row = ownedRow('sticker', params[0], user);
  requireToday(row.day);
  const body = await readJson(req);
  q('UPDATE stickers SET x = ?, y = ? WHERE id = ?').run(posX(body.x, 60), posY(body.y, 40), row.id);
  const sticker = stickerOut(q('SELECT * FROM stickers WHERE id = ?').get(row.id));
  emit('sticker', sticker, row);
  return { sticker: forViewer(sticker, user.id) };
});

route('DELETE', /^\/api\/(note|reply|sticker)s?\/([\w-]+)$/, ({ user, params }) => {
  requireUser(user);
  const [type, id] = [params[0], params[1]];
  const row = ownedRow(type, id, user);
  requireToday(dayOf(type, row));
  q(`UPDATE ${TABLES[type]} SET hidden = 2 WHERE id = ?`).run(id);
  broadcastRemoval(type, id);
  if (type === 'reply') broadcast('note', getNote(row.note_id));
  return { ok: true };
});

// Personal sticker collection (drawn or uploaded, stored as small PNGs).
route('GET', /^\/api\/my-stickers$/, ({ user }) => {
  requireUser(user);
  return { stickers: q('SELECT id, data FROM my_stickers WHERE user_id = ? ORDER BY created_at DESC').all(user.id) };
});
route('POST', /^\/api\/my-stickers$/, async ({ req, user }) => {
  requirePoster(user);
  const { data } = await readJson(req, 220 * 1024);
  if (!validPng(data)) throw new HttpError(400, 'Stickers must be small PNG images (under 150 KB).');
  const count = q('SELECT COUNT(*) AS c FROM my_stickers WHERE user_id = ?').get(user.id).c;
  if (count >= 40) throw new HttpError(400, 'Your collection is full (40 stickers). Remove one to add another.');
  rateLimit(`mysticker:${user.id}`, 10, 600_000);
  const id = randomUUID();
  q('INSERT INTO my_stickers (id, user_id, data, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, data, now());
  return { sticker: { id, data } };
});
route('DELETE', /^\/api\/my-stickers\/([\w-]+)$/, ({ user, params }) => {
  requireUser(user);
  q('DELETE FROM my_stickers WHERE id = ? AND user_id = ?').run(params[0], user.id);
  return { ok: true };
});

// Reports: a quiet backstop for anything the automatic checks miss. Reports never give
// strikes; enough of them send the post back for a moderator to review.
const FLAG_REASONS = ['hurtful', 'harassment', 'hate', 'self-harm', 'spam', 'inappropriate', 'other'];
route('POST', /^\/api\/flag$/, async ({ req, user }) => {
  requireUser(user);
  const { type, id, reason } = await readJson(req);
  if (!TABLES[type]) throw new HttpError(400, 'Unknown item.');
  const row = q(`SELECT * FROM ${TABLES[type]} WHERE id = ?`).get(id);
  if (!row || row.hidden) throw new HttpError(404, 'That is no longer on the board.');
  if (row.user_id === user.id) throw new HttpError(400, 'You can’t flag your own post, but you can delete it.');
  rateLimit(`flag:${user.id}`, 30, 3_600_000);
  q('INSERT OR IGNORE INTO flags (target_type, target_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(
    type, id, user.id, FLAG_REASONS.includes(reason) ? reason : 'other', now(),
  );
  // Banned identities can still flag, but only active identities count toward auto-hiding.
  const { c } = q(`SELECT COUNT(*) AS c FROM flags f JOIN users u ON u.id = f.user_id
                   WHERE f.target_type = ? AND f.target_id = ? AND u.banned = 0`).get(type, id);
  if (c >= CONFIG.flagsToHide) {
    q(`UPDATE ${TABLES[type]} SET hidden = ? WHERE id = ?`).run(PENDING, id);
    broadcastRemoval(type, id);
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
function adminItem(type, id, flagInfo) {
  const row = q(`SELECT t.*, u.handle, u.strikes, u.banned FROM ${TABLES[type]} t JOIN users u ON u.id = t.user_id WHERE t.id = ?`).get(id);
  if (!row) return null;
  return {
    type, id, flags: flagInfo?.c || 0, reasons: flagInfo ? flagInfo.reasons.split(',') : [], when: flagInfo?.last || row.created_at,
    text: row.text ?? null, kind: row.kind ?? null, content: row.content ?? null, day: dayOf(type, row), why: row.text ? checkText(row.text).hold : null,
    hidden: row.hidden, pending: row.hidden === PENDING, struck: !!row.struck, author: row.handle, authorStrikes: row.strikes, authorBanned: !!row.banned,
  };
}
route('GET', /^\/api\/admin\/flags$/, ({ req }) => {
  requireAdmin(req);
  const seen = new Set();
  const items = [];
  const flagged = new Map(q(`SELECT target_type, target_id, COUNT(*) AS c, GROUP_CONCAT(DISTINCT reason) AS reasons, MAX(created_at) AS last
                             FROM flags GROUP BY target_type, target_id`).all().map((g) => [`${g.target_type}:${g.target_id}`, g]));
  // Waiting for approval first, oldest first, so nobody waits too long.
  for (const [type, table] of Object.entries(TABLES)) {
    for (const r of q(`SELECT id FROM ${table} WHERE hidden = ? ORDER BY created_at LIMIT 200`).all(PENDING)) {
      seen.add(`${type}:${r.id}`);
      items.push(adminItem(type, r.id, flagged.get(`${type}:${r.id}`)));
    }
  }
  for (const [key, g] of [...flagged].sort((x, y) => y[1].last - x[1].last).slice(0, 200)) {
    if (!seen.has(key)) items.push(adminItem(g.target_type, g.target_id, g));
  }
  return { items: items.filter(Boolean) };
});
route('POST', /^\/api\/admin\/resolve$/, async ({ req }) => {
  requireAdmin(req);
  const { type, id, action } = await readJson(req);
  if (!TABLES[type]) throw new HttpError(400, 'Unknown item.');
  const row = q(`SELECT * FROM ${TABLES[type]} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Not found.');
  const clearFlags = () => q('DELETE FROM flags WHERE target_type = ? AND target_id = ?').run(type, id);
  if (action === 'approve' || action === 'restore') {
    q(`UPDATE ${TABLES[type]} SET hidden = 0, struck = 0 WHERE id = ?`).run(id);
    clearFlags();
    if (row.struck) removeStrike(row.user_id);
    // Now everyone can see it.
    if (type === 'note') broadcast('note', getNote(id));
    if (type === 'sticker') broadcast('sticker', stickerOut(q('SELECT * FROM stickers WHERE id = ?').get(id)));
    if (type === 'reply') {
      const note = q('SELECT day FROM notes WHERE id = ?').get(row.note_id);
      broadcast('reply', { ...replyOut(q(`${REPLY_SQL} WHERE r.id = ?`).get(id)), day: note?.day });
      broadcast('note', getNote(row.note_id));
    }
  } else if (action === 'decline') {
    q(`UPDATE ${TABLES[type]} SET hidden = 1 WHERE id = ?`).run(id);
    clearFlags();
    sendTo(row.user_id, 'removed', { type, id, declined: true });
    broadcastRemoval(type, id);
  } else if (action === 'remove') {
    hideForModeration(type, id);
    clearFlags();
  } else if (action === 'dismiss') {
    clearFlags();
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
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (isHttps(req)) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname === '/api/stream' && req.method === 'GET') return openStream(req, res, requireUser(sessionUser(req)));
    if (url.pathname.startsWith('/api/')) {
      checkCsrf(req);
      const user = sessionUser(req);
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
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong on our side.' });
  }
});

// A friendly first note on a fresh board, so nobody arrives to an empty room.
function seedWelcome() {
  if (q('SELECT COUNT(*) AS c FROM notes').get().c > 0) return;
  if (!q("SELECT 1 FROM users WHERE id = 'system'").get()) {
    // Unusable passphrase hash: nobody can log in as the board itself.
    q("INSERT INTO users (id, handle, pass_hash, animal, color, created_at) VALUES ('system', 'board-0000', '!', 'Board', '#57534e', ?)").run(now());
  }
  q('INSERT INTO notes (id, day, user_id, text, color, x, y, rot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), today(), 'system',
    'Welcome.\n\nThis is a board for anyone who wants someone to talk to. Pin a thought, a worry, a small win. There’s no word limit. Someone will write back.\n\nYou’re anonymous here. Be kind, always.',
    'butter', CONFIG.boardW / 2 - 130, CONFIG.boardH / 2 - 140, -0.6, now(),
  );
}
seedWelcome();

server.listen(CONFIG.port, () => {
  console.log(`[kindboard] listening on http://localhost:${CONFIG.port}  (boards roll over at midnight ${CONFIG.timeZone})`);
});
