// Kindboard client — vanilla JS, no build step.
// Flow: hello → what this is → kind rules → log in → calendar → a day's board.

import { DOODLES, doodleEl } from './doodles.js';
import { EMOJI_GROUPS } from './emoji.js';
import { startGarden, drawCharacter, characterPortrait, LOOKS, HAIRSTYLES, randomLook, WEATHERS } from './garden.js';
import { ANIMAL_SPECS, describeVariant } from './animals.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.filter((c) => c != null));
  return el;
}
const SVG = 'http://www.w3.org/2000/svg';
function icon(name) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', 'i');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}

const BRUSH_COLORS = ['#1c1a17', '#ffffff', '#a24a2a', '#d97706', '#ca8a04', '#4d7c0f', '#0f766e', '#1d4ed8', '#7e22ce', '#be185d'];

const S = {
  me: null, cfg: null, view: null, day: null, archived: false,
  notes: new Map(), stickers: new Map(), noteEls: new Map(), stickerEls: new Map(),
  cam: { x: 0, y: 0, z: 1 }, openNote: null, placing: null, myStickers: [], composeColor: 'butter',
  stream: null, calMonth: null, words: null, chain: null, signupAnimal: null,
};

// ---------------------------------------------------------------- api

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-kindboard': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
    if (data.auth && S.view !== 'auth' && S.view !== 'intro') {
      S.me = null;
      go('/login', { next: location.pathname + location.hash });
    }
    throw err;
  }
  return data;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- utils

function toast(msg, ms = 3200) {
  const t = h('div', { class: 'toast', text: msg });
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const parseDay = (d) => new Date(`${d}T12:00:00`);
const fmtDay = (d, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => parseDay(d).toLocaleDateString(undefined, opts);
const isoDay = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
function shiftDay(d, n) {
  const dt = parseDay(d);
  dt.setDate(dt.getDate() + n);
  return isoDay(dt);
}
// Who someone looks like: their own custom character if they chose it, otherwise their own
// version of their pixel animal (colour + accessory, unique among people with the same animal).
function animalLook(who) {
  return who?.animal && ANIMAL_SPECS[who.animal] ? { animal: who.animal, variant: who.variant || 0 } : null;
}
function faceOf(who) {
  if (!who) return null;
  if (who.avatarMode === 'custom' && who.look) return who.look;
  return animalLook(who) || who.look || null;
}
function setAvatar(el, who) {
  el.style.setProperty('--av', who.avatar || who.color);
  const face = faceOf(who);
  el.classList.toggle('has-px', !!face);
  if (face) el.replaceChildren(h('img', { src: characterPortrait(face), alt: '', draggable: 'false' }));
  else el.textContent = (who.animal || '?')[0];
}
const displayName = (who) => (who.animal === 'Board' ? 'Kindboard' : who.name);
const canPost = () => S.me && !S.me.banned && !S.archived;
function showError(container, err) {
  const p = $('.form-error', container);
  if (!p) return;
  p.textContent = err?.message || err || '';
  p.hidden = !err;
}
async function copy(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    window.prompt('Copy this:', text);
  }
}

// ---------------------------------------------------------------- router

const ROUTES = [
  [/^\/$/, 'intro'],
  [/^\/login$/, 'auth'],
  [/^\/calendar$/, 'calendar'],
  [/^\/day\/(\d{4}-\d{2}-\d{2})$/, 'board'],
];
function go(path, { replace = false, next } = {}) {
  if (next) sessionStorage.setItem('kb_next', next);
  if (path === 'today') path = `/day/${S.cfg.today}`;
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
}
window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  go(el.dataset.go);
});

const LOADER_LABELS = { calendar: 'Opening your calendar', board: 'Unfolding the notes' };

async function route() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  let view = 'intro';
  let param = null;
  for (const [re, v] of ROUTES) {
    const m = path.match(re);
    if (m) { view = v; param = m[1]; break; }
  }
  // Signed-out visitors always start with hello, then the rules, then log in — then go where they were headed.
  if ((view === 'calendar' || view === 'board') && !S.me) {
    sessionStorage.setItem('kb_next', location.pathname + location.hash);
    history.replaceState({}, '', '/');
    view = 'intro';
  }
  if (view === 'auth' && S.me) {
    history.replaceState({}, '', '/calendar');
    view = 'calendar';
  }
  if (view !== 'board') {
    setPen(false);
    closeList();
    closeThread(false);
    closeTray();
    stopPlacing();
  }
  if (view !== 'intro') {
    stopHello();
    garden?.pause();
  }
  if (view === 'calendar') {
    if (!visitor) { visitor = startGarden($('#visitor'), { mode: 'visit', look: myLook() }); visitor.setEnv(currentEnv()); }
    else if (S.view !== 'calendar') { visitor.setLook(myLook()); visitor.restart(); }
    visitor.play();
  } else {
    visitor?.pause();
  }
  if (view === 'intro') showIntro();
  if (view === 'auth') showAuth();
  // Every wait is a small pause with a quote.
  if (view === 'calendar' || view === 'board') {
    const switching = S.view !== view || (view === 'board' && param !== S.day);
    const load = view === 'calendar' ? () => showCalendar() : () => showBoard(param);
    if (switching) await withLoader(LOADER_LABELS[view], load, { min: S.view === 'board' && view === 'board' ? 900 : 1700 });
    else await load();
  }
  setView(view);
  if (view === 'board') openFromHash();
  if (view === 'calendar') requestAnimationFrame(drawTrail);
}

function setView(view) {
  for (const v of $$('.view')) v.classList.toggle('active', v.id === view);
  S.view = view;
  if (view !== 'intro') {
    document.title = { auth: 'Log in · Kindboard', calendar: 'Calendar · Kindboard', board: S.day ? `${fmtDay(S.day, { month: 'long', day: 'numeric' })} · Kindboard` : 'Kindboard' }[view];
  }
}

// ---------------------------------------------------------------- waiting screen with a quote

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let quoteTurn = 0;
function nextQuote() {
  const list = S.quotes?.length ? S.quotes : [{ text: 'We’re all just walking each other home.', author: 'Ram Dass' }];
  return list[quoteTurn++ % list.length];
}
async function withLoader(label, task, { min = 1600 } = {}) {
  const el = $('#loader');
  const q = nextQuote();
  $('#loaderLabel').textContent = `${label}…`;
  const words = q.text.split(/\s+/);
  $('#loaderQuote').replaceChildren(...words.flatMap((w, i) => {
    const span = h('span', { text: w });
    span.style.setProperty('--i', i);
    return [span, ' '];
  }));
  $('#loaderBy').replaceChildren(q.author, ...(q.source ? [', ', h('cite', { text: q.source })] : []));
  el.style.setProperty('--after', `${Math.min(words.length * 40 + 500, 1600)}ms`);
  el.classList.remove('out');
  el.hidden = false;
  const t0 = performance.now();
  try {
    return await task();
  } finally {
    await sleep(Math.max(0, min - (performance.now() - t0)));
    el.classList.add('out');
    setTimeout(() => { if (el.classList.contains('out')) el.hidden = true; }, 560);
  }
}

// ---------------------------------------------------------------- 1. intro: hello in many languages → about → rules

const HELLOS = [
  ['Hello', 'English', 'en'], ['Hola', 'Spanish', 'es'], ['Bonjour', 'French', 'fr'], ['नमस्ते', 'Hindi', 'hi'],
  ['你好', 'Mandarin', 'zh'], ['مرحبا', 'Arabic', 'ar'], ['こんにちは', 'Japanese', 'ja'], ['안녕하세요', 'Korean', 'ko'],
  ['Olá', 'Portuguese', 'pt'], ['Hallo', 'German', 'de'], ['Ciao', 'Italian', 'it'], ['Привет', 'Russian', 'ru'],
  ['Jambo', 'Swahili', 'sw'], ['Merhaba', 'Turkish', 'tr'], ['Γεια σου', 'Greek', 'el'], ['שלום', 'Hebrew', 'he'],
  ['নমস্কার', 'Bengali', 'bn'], ['வணக்கம்', 'Tamil', 'ta'], ['สวัสดี', 'Thai', 'th'], ['Xin chào', 'Vietnamese', 'vi'],
  ['Halo', 'Indonesian', 'id'], ['Cześć', 'Polish', 'pl'], ['سلام', 'Persian', 'fa'], ['آداب', 'Urdu', 'ur'],
  ['Kumusta', 'Tagalog', 'tl'], ['Aloha', 'Hawaiian', 'haw'], ['Sawubona', 'Zulu', 'zu'], ['Dia dhuit', 'Irish', 'ga'],
  ['Привіт', 'Ukrainian', 'uk'], ['Hej', 'Swedish', 'sv'], ['Hei', 'Finnish', 'fi'], ['ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'Punjabi', 'pa'],
  ['నమస్కారం', 'Telugu', 'te'], ['നമസ്കാരം', 'Malayalam', 'ml'], ['ನಮಸ್ಕಾರ', 'Kannada', 'kn'], ['નમસ્તે', 'Gujarati', 'gu'],
  ['नमस्कार', 'Marathi', 'mr'], ['ሰላም', 'Amharic', 'am'], ['Báwo', 'Yoruba', 'yo'], ['Kia ora', 'Māori', 'mi'],
  ['Ahoj', 'Czech', 'cs'], ['Szia', 'Hungarian', 'hu'], ['Sveiki', 'Latvian', 'lv'], ['Sannu', 'Hausa', 'ha'],
  ['မင်္ဂလာပါ', 'Burmese', 'my'], ['Сайн байна уу', 'Mongolian', 'mn'], ['Bula', 'Fijian', 'fj'], ['Salut', 'Romanian', 'ro'],
];
const RTL = new Set(['ar', 'he', 'fa', 'ur']);
const graphemes = (s) => (Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment) : [...s]);

let helloRun = null;
function stopHello() {
  if (helloRun) helloRun.alive = false;
  helloRun = null;
}
async function helloLoop(run) {
  const text = $('#helloText');
  const lang = $('#helloLang');
  let i = 0;
  while (run.alive) {
    const [word, name, code] = HELLOS[i % HELLOS.length];
    text.lang = code;
    text.dir = RTL.has(code) ? 'rtl' : 'ltr';
    lang.textContent = i === 0 ? name : `“${HELLOS[0][0].toLowerCase()}” in ${name}`;
    lang.style.opacity = 1;
    const g = graphemes(word);
    // Wide scripts (Japanese, Korean, Thai…) need a smaller size to fit on one line.
    const ems = g.reduce((sum, ch) => sum + (/[\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(ch) ? 1 : 0.62), 0);
    text.parentElement.style.fontSize = `min(200px, 15vw, ${Math.floor(82 / ems)}vw, ${Math.floor(780 / ems)}px)`;
    for (let k = 1; k <= g.length && run.alive; k++) {
      text.textContent = g.slice(0, k).join('');
      await sleep(70 + Math.random() * 70);
    }
    if (S.view === 'intro' && S.introStep === 0) document.title = `${word} · kindboard`;
    await sleep(i === 0 ? 1600 : 1250);
    for (let k = g.length - 1; k >= 0 && run.alive; k--) {
      text.textContent = g.slice(0, k).join('');
      await sleep(38);
    }
    lang.style.opacity = 0;
    await sleep(260); // the little pause where it "hits space"
    i++;
  }
}

let garden = null;
let visitor = null; // the same gardener, popping by on the calendar
function showIntro() {
  if (!garden) {
    garden = startGarden($('#garden'), { look: faceOf(S.me) });
    garden.onSky(({ dark, caption, top, bottom }) => {
      const intro = $('#intro');
      intro.classList.toggle('sky-dark', dark);
      $('#skyCaption').textContent = caption;
      // words take their colour from the sky: a deep tone of it by day, soft moonlight by night
      const mix = (a, b, t) => {
        const A = parseInt(a.slice(1), 16);
        const B = parseInt(b.slice(1), 16);
        return `#${[16, 8, 0].map((sh) => Math.round(((A >> sh) & 255) + (((B >> sh) & 255) - ((A >> sh) & 255)) * t).toString(16).padStart(2, '0')).join('')}`;
      };
      const ink = dark ? mix('#efe8dc', top, 0.12) : mix(top, '#2a2a3a', 0.72);
      intro.style.setProperty('--sky-ink', ink);
      intro.style.setProperty('--sky-ink-2', dark ? mix(ink, top, 0.25) : mix(ink, bottom, 0.28));
      intro.style.setProperty('--sky-ink-3', dark ? mix(ink, top, 0.4) : mix(ink, bottom, 0.42));
      intro.style.setProperty('--sky-glow', dark ? 'rgba(10, 14, 40, 0.35)' : `${top}40`);
    });
    garden.setEnv(currentEnv());
  }
  garden.setLook(faceOf(S.me));
  garden.play();
  const step = S.me ? 0 : Number(new URLSearchParams(location.search).get('step')) || 0;
  setIntroStep(step);
}
function setIntroStep(n) {
  S.introStep = n;
  $('#intro').dataset.step = n;
  $$('.intro-step').forEach((el, i) => {
    el.classList.toggle('on', i === n);
    el.classList.toggle('past', i < n);
  });
  $$('.intro-dots i').forEach((d, i) => d.classList.toggle('on', i === n));
  $('#skipIntro').textContent = S.me ? `Continue as ${S.me.name}` : 'Skip intro';
  $('.intro-step[data-step="hello"] .tap-hint').textContent = S.me ? 'Click anywhere to continue' : 'Click anywhere to begin';
  if (n === 0 && !helloRun) {
    helloRun = { alive: true };
    helloLoop(helloRun);
  }
  if (n !== 0) {
    stopHello();
    document.title = n === 1 ? 'What is Kindboard?' : 'A few kind rules · Kindboard';
  }
}
function leaveIntro() {
  if (S.me) return go(sessionStorage.getItem('kb_next') || '/calendar');
  go('/login');
}
$('#intro').addEventListener('click', (e) => {
  if (e.target.closest('button, a, input, label')) return;
  if (S.introStep === 0) return S.me ? leaveIntro() : setIntroStep(1);
  if (S.introStep === 1) setIntroStep(2);
});
document.addEventListener('keydown', (e) => {
  if (S.view !== 'intro' || (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowRight')) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault();
  if (S.introStep < 2) S.me && S.introStep === 0 ? leaveIntro() : setIntroStep(S.introStep + 1);
});
$('#skipIntro').onclick = () => {
  if (S.me) return leaveIntro();
  setIntroStep(2);
};
$('#agreeBtn').onclick = () => {
  store.set('kb_agreed', '1');
  $('#agree').checked = true;
  go('/login');
};
for (const el of $$('[data-doodle]')) el.append(doodleEl(el.dataset.doodle));

// ---------------------------------------------------------------- 2. auth

function updateGoogleLinks() {
  const on = !!S.cfg?.google;
  for (const el of $$('[data-google], [data-google-note], [data-google-or]')) el.hidden = !on;
  for (const a of $$('[data-google]')) {
    const signup = !!a.closest('#signupForm');
    const remember = (signup ? $('#rememberNew') : $('#rememberLogin')).checked ? '1' : '0';
    a.href = `/auth/google/start?remember=${remember}${signup && S.signupAnimal ? `&animal=${encodeURIComponent(S.signupAnimal)}` : ''}`;
  }
}
for (const id of ['#rememberNew', '#rememberLogin']) $(id).addEventListener('change', updateGoogleLinks);

function showAuth() {
  if (!S.signupAnimal) rerollAnimal(false);
  if (store.get('kb_agreed')) $('#agree').checked = true;
  updateGoogleLinks();
  const g = new URLSearchParams(location.search).get('google');
  const why = { expired: 'That took a little too long. Please try again.', cancelled: 'Google sign-in was cancelled.', error: 'Google sign-in didn\u2019t work. Please try again.', paused: 'New identities are paused from this network for a little while.', busy: 'Too many new identities from here. Try again later.', off: 'Google sign-in isn\u2019t set up yet.' }[g];
  if (why) toast(why, 5000);
  showError($('#signupForm'), null);
  showError($('#loginForm'), null);
}
function setAuthMode(mode) {
  $('#signupForm').hidden = mode !== 'new';
  $('#loginForm').hidden = mode !== 'return';
  (mode === 'new' ? $('#newPass') : $('#loginHandle')).focus({ preventScroll: true });
}
for (const b of $$('.auth [data-mode]')) b.onclick = () => setAuthMode(b.dataset.mode);
$('.auth .back').dataset.go = '/?step=2';
const PICK_COLORS = ['#c2410c', '#b45309', '#a16207', '#4d7c0f', '#047857', '#0f766e', '#0369a1', '#4338ca', '#7e22ce', '#be185d'];
function rerollAnimal(animate = true) {
  const list = S.cfg.animals.filter((a) => a !== S.signupAnimal);
  S.signupAnimal = list[Math.floor(Math.random() * list.length)];
  const pick = $('.animal-pick');
  setAvatar($('#pickAvatar'), { animal: S.signupAnimal, variant: Math.floor(Math.random() * 36), color: PICK_COLORS[Math.floor(Math.random() * PICK_COLORS.length)] });
  $('#pickName').textContent = `Anonymous ${S.signupAnimal}`;
  if (animate) {
    pick.classList.remove('spin');
    void pick.offsetWidth;
    pick.classList.add('spin');
  }
}
$('#rerollAnimal').onclick = () => { rerollAnimal(); updateGoogleLinks(); };
for (const b of $$('.reveal')) {
  b.onclick = () => {
    const input = b.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
    b.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
  };
}
function strength(p) {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 20;
  const unique = new Set(p).size;
  return Math.log2(Math.max(pool, 2)) * Math.min(p.length, unique * 2);
}
$('#newPass').addEventListener('input', (e) => {
  const bits = strength(e.target.value);
  const m = $('.meter');
  m.style.setProperty('--w', `${Math.min(100, (bits / 70) * 100)}%`);
  m.style.setProperty('--meter', e.target.value.length < 10 ? 'var(--ink-3)' : bits < 40 ? '#c2410c' : bits < 60 ? '#ca8a04' : 'var(--live)');
});

async function afterLogin(me, { fresh = false } = {}) {
  S.me = me;
  renderMe();
  connectStream();
  $('#newPass').value = '';
  $('#loginPass').value = '';
  const next = sessionStorage.getItem('kb_next');
  sessionStorage.removeItem('kb_next');
  if (fresh) {
    $('#savedName').textContent = me.name;
    $('#savedHandle').textContent = me.handle;
    setAvatar($('#savedAvatar'), me);
    $('#savedDlg').showModal();
    $('#savedDlg').addEventListener('close', () => go(next || '/calendar'), { once: true });
  } else {
    go(next || '/calendar');
  }
}
async function submitWith(form, fn) {
  showError(form, null);
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    await fn();
  } catch (err) {
    showError(form, err);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}
$('#signupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  if ($('#newPass').value.length < 10) return showError(form, 'Use at least 10 characters. A few words work well.');
  if (!$('#agree').checked) return showError(form, 'Please tick \u201cI\u2019ll be kind\u201d to continue.');
  submitWith(form, async () => {
    try {
      const { me } = await api('POST', '/api/signup', { animal: S.signupAnimal, passphrase: $('#newPass').value, remember: $('#rememberNew').checked });
      await afterLogin(me, { fresh: true });
    } catch (err) {
      if (err.data?.needGoogle) {
        // new identities from here have to come through Google: point at the button
        const g = $('[data-google]', form);
        g.classList.remove('nudge');
        void g.offsetWidth;
        g.classList.add('nudge');
        g.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      throw err;
    }
  });
});
$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitWith(e.target, async () => {
    try {
      const { me } = await api('POST', '/api/login', { handle: $('#loginHandle').value, passphrase: $('#loginPass').value, remember: $('#rememberLogin').checked });
      await afterLogin(me);
    } catch (err) {
      $('#loginPass').select();
      throw err;
    }
  });
});
$('[data-copy-handle]').onclick = () => copy(S.me.handle, 'Handle copied');

// ---------------------------------------------------------------- the little garden: gentle pats only

const myLook = () => faceOf(S.me) || (S.me ? { style: 'short', skin: 1, hair: 2, suit: 2 } : null);
function gardenFor(view) {
  return view === 'intro' ? garden : view === 'calendar' ? visitor : null;
}
window.addEventListener('pointermove', (e) => {
  const g = gardenFor(S.view);
  document.body.classList.toggle('pat-cursor', !!g?.hover(e.clientX, e.clientY) && !e.target.closest('button, a, input, textarea, .today-card, .cal-map, .cal-grid'));
}, { passive: true });
window.addEventListener('click', (e) => {
  if (e.target.closest('button, a, input, textarea, label, dialog, .today-card, .cal-map, .cal-grid')) return;
  const g = gardenFor(S.view);
  if (g?.pat(e.clientX, e.clientY)) {
    // a pat isn't a "click to continue"
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// ---------------------------------------------------------------- sky: your local time of day, and (if you allow it) your weather

const TIME_PRESETS = { auto: null, dawn: 6.3, day: 12, dusk: 18.4, night: 23 };
const sky = {
  weather: store.get('kb_weather') || 'live', // 'live' or a fixed WEATHERS value
  time: store.get('kb_time') || 'auto',
  live: null, // last weather from Open-Meteo
};
try { sky.live = JSON.parse(store.get('kb_live_weather') || 'null'); } catch { /* ignore */ }
const params = new URLSearchParams(location.search);
if (WEATHERS.includes(params.get('weather'))) sky.weather = params.get('weather');
if (params.get('sky') in TIME_PRESETS) sky.time = params.get('sky');

function localHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}
function currentEnv() {
  const hour = TIME_PRESETS[sky.time] ?? localHour();
  const weather = sky.weather === 'live' ? (sky.live && Date.now() - sky.live.at < 3 * 3600_000 ? sky.live.weather : 'clear') : sky.weather;
  return { hour, weather };
}
function phaseName(hour) {
  const h = ((hour % 24) + 24) % 24;
  return h < 5 || h >= 21 ? 'Night' : h < 8 ? 'Dawn' : h < 17 ? 'Day' : h < 19.5 ? 'Dusk' : 'Evening';
}
function refreshSky() {
  const env = currentEnv();
  garden?.setEnv(env);
  visitor?.setEnv(env);
  const time = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  $('#skyChipText').textContent = `${phaseName(env.hour)} \u00b7 ${env.weather}${sky.time === 'auto' ? ` \u00b7 ${time}` : ''}`;
}
// Open-Meteo weather codes → our five skies
function weatherFromCode(code) {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 2) return 'cloudy';
  return 'clear';
}
async function fetchLiveWeather() {
  const geo = JSON.parse(store.get('kb_geo') || 'null');
  if (!geo) return;
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=weather_code`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    const data = await res.json();
    sky.live = { weather: weatherFromCode(Number(data.current?.weather_code ?? 0)), at: Date.now() };
    store.set('kb_live_weather', JSON.stringify(sky.live));
    refreshSky();
  } catch { /* offline or blocked: keep the clear sky */ }
}
function useLocalWeather() {
  if (!navigator.geolocation) return toast('Your browser can\u2019t share a location.');
  navigator.geolocation.getCurrentPosition((pos) => {
    // rounded to ~10 km, kept only in this browser
    store.set('kb_geo', JSON.stringify({ lat: Math.round(pos.coords.latitude * 10) / 10, lon: Math.round(pos.coords.longitude * 10) / 10 }));
    sky.weather = 'live';
    store.set('kb_weather', 'live');
    fetchLiveWeather();
    renderSkyMenu();
    toast('Showing the weather where you are.');
  }, () => toast('No problem. You can still pick a sky by hand.'), { maximumAge: 3600_000, timeout: 10000 });
}
function renderSkyMenu() {
  const hasGeo = !!store.get('kb_geo');
  $('#skyLocal').setAttribute('aria-pressed', String(hasGeo && sky.weather === 'live'));
  $('#skyLocal span').textContent = hasGeo ? (sky.weather === 'live' ? 'Using your local weather' : 'Use my local weather') : 'Use my local weather';
  const opts = (el, values, current, set) => $(el).replaceChildren(...values.map((v) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === current), text: v === 'live' ? (hasGeo ? 'my weather' : 'clear') : v });
    b.onclick = () => { set(v); renderSkyMenu(); refreshSky(); };
    return b;
  }));
  opts('#skyWeather', ['live', ...WEATHERS.filter((w) => w !== 'clear' || hasGeo)], sky.weather, (v) => { sky.weather = v; store.set('kb_weather', v); });
  opts('#skyTime', Object.keys(TIME_PRESETS), sky.time, (v) => { sky.time = v; store.set('kb_time', v); });
}
$('#skyChip').onclick = (e) => {
  e.stopPropagation();
  const menu = $('#skyMenu');
  if (!menu.hidden) return (menu.hidden = true);
  renderSkyMenu();
  placePopover(menu, e.currentTarget);
};
$('#skyLocal').onclick = (e) => { e.stopPropagation(); useLocalWeather(); };
$('#skyMenu').addEventListener('click', (e) => e.stopPropagation());
setInterval(refreshSky, 60_000); // the sky drifts with your clock
setInterval(() => { if (sky.weather === 'live') fetchLiveWeather(); }, 30 * 60_000);

// ---------------------------------------------------------------- your character

let draftLook = null;
let draftMode = 'animal';
function renderLookDialog() {
  const animal = draftMode === 'animal';
  for (const b of $$('[data-look-mode]')) {
    const on = b.dataset.lookMode === draftMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
  $('#lookRows').hidden = animal;
  $('#lookShuffle').hidden = animal;
  $('#lookIntro').textContent = animal
    ? 'Everyone starts as their animal. This one is yours.'
    : 'Make a little person of your own. They walk into the garden to say hi. Pat their head to make them smile.';
  $('#lookAnimalNote').textContent = animal
    ? `Your ${S.me.animal}: ${describeVariant(S.me.variant)}. No other ${S.me.animal} on Kindboard looks quite like this one.`
    : '';
  drawCharacter($('#lookPreview'), animal ? animalLook(S.me) : draftLook, 'wave1', 'happy');
  if (animal) return;
  const opt = (container, items, isOn, onPick, makeBtn) => {
    $(container).replaceChildren(...items.map((item, i) => {
      const b = makeBtn(item, i);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(isOn(item, i)));
      b.onclick = () => { onPick(item, i); renderLookDialog(); };
      return b;
    }));
  };
  const swatch = (color, label) => {
    const b = h('button', { type: 'button', class: 'look-opt', 'aria-label': label });
    b.style.setProperty('--sw', color);
    return b;
  };
  opt('#lookStyle', HAIRSTYLES, (st) => draftLook.style === st, (st) => { draftLook.style = st; },
    (st) => h('button', { type: 'button', class: 'look-opt style', text: st }));
  opt('#lookHair', LOOKS.hair, (_, i) => draftLook.hair === i, (_, i) => { draftLook.hair = i; }, (c, i) => swatch(c, `Hair colour ${i + 1}`));
  opt('#lookSkin', LOOKS.skin, (_, i) => draftLook.skin === i, (_, i) => { draftLook.skin = i; }, (c, i) => swatch(c, `Skin tone ${i + 1}`));
  opt('#lookSuit', LOOKS.suit, (_, i) => draftLook.suit === i, (_, i) => { draftLook.suit = i; }, (c, i) => swatch(c[0], `Outfit colour ${i + 1}`));
}
$('#googleLinkBtn').onclick = () => { if (!S.me?.google) location.href = '/auth/google/start?mode=link'; };
$('#lookBtn').onclick = () => {
  hidePopovers();
  draftLook = { ...(S.me?.look || { style: 'short', skin: 1, hair: 2, suit: 2 }) };
  draftMode = S.me?.avatarMode === 'custom' && S.me.look ? 'custom' : animalLook(S.me) ? 'animal' : 'custom';
  $('[data-look-mode="animal"]').hidden = !animalLook(S.me);
  renderLookDialog();
  $('#lookDlg').showModal();
};
for (const b of $$('[data-look-mode]')) b.onclick = () => { draftMode = b.dataset.lookMode; renderLookDialog(); };
$('#lookShuffle').onclick = () => { draftLook = randomLook(); renderLookDialog(); };
$('#lookSave').onclick = async () => {
  try {
    const { me } = draftMode === 'animal'
      ? await api('PUT', '/api/me/avatar', { mode: 'animal' })
      : await api('PUT', '/api/me/look', draftLook);
    S.me = { ...S.me, ...me };
    renderMe();
    for (const n of S.notes.values()) if (n.mine) { Object.assign(n, { look: me.look, avatarMode: me.avatarMode, variant: me.variant }); upsertNote(n); }
    if (S.openNote && S.notes.get(S.openNote)) renderThreadNote(S.notes.get(S.openNote));
    garden?.setLook(faceOf(me));
    visitor?.setLook(faceOf(me));
    $('#lookDlg').close();
    toast('Saved. Look out for them in the garden.');
  } catch (err) {
    toast(err.message);
  }
};

// ---------------------------------------------------------------- identity menu

function renderMe() {
  if (!S.me) return;
  for (const el of $$('[data-me] .avatar, .me-menu .avatar, #tcAvatar')) setAvatar(el, S.me);
  for (const el of $$('[data-me] .me-name')) el.textContent = S.me.name;
  $('.me-big-name').textContent = S.me.name;
  $('.me-handle').textContent = `@${S.me.handle}`;
  const gl = $('#googleLinkBtn');
  gl.hidden = !S.cfg?.google;
  gl.disabled = !!S.me.google;
  gl.querySelector('span').textContent = S.me.google ? 'Google sign-in is on' : 'Add Google sign-in';
  $('.strikes').replaceChildren(
    ...Array.from({ length: S.me.strikesToBan }, (_, i) => h('span', { class: `s${i < S.me.strikes ? ' on' : ''}` })),
    S.me.banned ? 'Paused after 2 strikes' : `${S.me.strikes} of ${S.me.strikesToBan} strikes`,
  );
  const av = h('span', { class: 'avatar' });
  setAvatar(av, S.me);
  $('.reply-as').replaceChildren(av, `Replying as ${S.me.name}`);
  const av2 = h('span', { class: 'avatar' });
  setAvatar(av2, S.me);
  $('.compose-as').replaceChildren(av2, S.me.name);
  $('#bannedBanner').hidden = !S.me.banned;
  updateTools();
}
function placePopover(pop, anchor) {
  pop.hidden = false;
  const a = anchor.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(12, Math.min(a.right - r.width, innerWidth - r.width - 12))}px`;
  pop.style.top = `${Math.min(a.bottom + 8, innerHeight - r.height - 12)}px`;
}
for (const b of $$('[data-me]')) {
  b.onclick = (e) => {
    e.stopPropagation();
    const pop = $('#meMenu');
    if (!pop.hidden) return (pop.hidden = true);
    renderMe();
    placePopover(pop, b);
  };
}
async function logout(all) {
  if (all && !confirm('Log out on every device where this identity is signed in?')) return;
  await api('POST', all ? '/api/logout-everywhere' : '/api/logout').catch(() => {});
  S.me = null;
  S.stream?.close();
  $('#meMenu').hidden = true;
  toast('Logged out. Come back soon.');
  go('/');
}
$('#logoutBtn').onclick = () => logout(false);
$('#logoutAllBtn').onclick = () => logout(true);

// ---------------------------------------------------------------- 3. calendar (a little level map of the month)

async function showCalendar() {
  renderMe();
  const hr = new Date().getHours();
  $('#greeting').textContent = `${hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, ${S.me.name.replace('Anonymous ', '')}`;
  setAvatar($('#tcAvatar'), S.me);
  if (!S.calMonth) S.calMonth = S.cfg.today.slice(0, 7);
  $('#todayLabel').textContent = fmtDay(S.cfg.today, { weekday: 'long', day: 'numeric', month: 'long' });
  const quote = api('GET', '/api/quote').then((d) => {
    $('#todayQuote').replaceChildren(`${d.quote.text}”`, h('small', { text: d.quote.author }));
    $('#tcNotes').textContent = d.notes;
    $('#tcNotesLabel').textContent = d.notes === 1 ? 'note pinned today' : 'notes pinned today';
    $('#tcReplies').textContent = d.replies;
    $('#tcRepliesLabel').textContent = d.replies === 1 ? 'kind reply' : 'kind replies';
  }).catch(() => {});
  await Promise.all([renderCalendar(), quote]);
}
$('#openToday').onclick = () => go('today');

let calMode = store.get('kb_cal') || 'map';
function setCalMode(mode) {
  calMode = mode;
  store.set('kb_cal', mode);
  for (const b of $$('[data-cal]')) {
    b.classList.toggle('active', b.dataset.cal === mode);
    b.setAttribute('aria-selected', String(b.dataset.cal === mode));
  }
  $('#calMap').hidden = mode !== 'map';
  $('.map-legend').hidden = mode !== 'map';
  $('#calGrid').hidden = mode !== 'grid';
  if (mode === 'map') requestAnimationFrame(drawTrail);
}
for (const b of $$('[data-cal]')) b.onclick = () => setCalMode(b.dataset.cal);

const dominant = (colors = []) => {
  const c = {};
  for (const x of colors) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
};

async function renderCalendar() {
  const [y, m] = S.calMonth.split('-').map(Number);
  $('#calTitle').textContent = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#calNext').disabled = S.calMonth >= S.cfg.today.slice(0, 7);
  let data = { days: {} };
  try {
    data = await api('GET', `/api/calendar?month=${S.calMonth}`);
  } catch { /* render without counts */ }
  S.calData = data;
  const daysIn = new Date(y, m, 0).getDate();

  // Map: days snake left→right, then right→left, like a path through levels.
  const nodes = [];
  for (let d = 1; d <= daysIn; d++) {
    const day = `${S.calMonth}-${String(d).padStart(2, '0')}`;
    const info = data.days[day];
    const future = day > S.cfg.today;
    const idx = d - 1;
    const row = Math.floor(idx / 7);
    const col = row % 2 === 0 ? idx % 7 : 6 - (idx % 7);
    const isToday = day === S.cfg.today;
    const node = h('button', {
      class: `node${info ? ' has' : ''}${isToday ? ' today' : ''}`,
      disabled: future,
      'aria-label': `${fmtDay(day)}${info ? `, ${info.notes} notes` : ''}${isToday ? ', today' : ''}`,
    }, String(d),
    h('span', { class: 'wk', text: parseDay(day).toLocaleDateString(undefined, { weekday: 'short' }) }),
    info ? h('span', { class: 'cnt', text: String(info.notes) }) : null,
    isToday ? h('span', { class: 'here', text: 'You are here' }) : null);
    if (info && !isToday) node.dataset.color = dominant(info.colors);
    node.style.gridRow = row + 1;
    node.style.gridColumn = col + 1;
    node.style.setProperty('--i', d);
    node.dataset.day = day;
    if (!future) {
      node.onclick = () => go(`/day/${day}`);
      node.onmouseenter = () => peek(node, day, info);
      node.onmouseleave = () => { $('#calPeek').hidden = true; };
    }
    nodes.push(node);
  }
  $('#mapNodes').replaceChildren(...nodes);

  // Grid: the classic month view.
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // weeks start on Monday
  const cells = Array.from({ length: 7 }, (_, i) => h('div', { class: 'cal-dow', text: new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }) }));
  for (let i = 0; i < firstDow; i++) cells.push(h('div'));
  for (let d = 1; d <= daysIn; d++) {
    const day = `${S.calMonth}-${String(d).padStart(2, '0')}`;
    const info = data.days[day];
    const future = day > S.cfg.today;
    const papers = h('span', { class: 'papers' });
    for (const [i, c] of (info?.colors || []).slice(0, 6).entries()) {
      const p = h('i');
      p.dataset.color = c;
      p.style.setProperty('--r', `${((i * 37) % 13) - 6}deg`);
      papers.append(p);
    }
    const btn = h('button', { class: `cal-day${day === S.cfg.today ? ' today' : ''}`, disabled: future, 'aria-label': `${fmtDay(day)}${info ? `, ${info.notes} notes` : ''}` },
      h('span', { class: 'num', text: String(d) }),
      h('span', {}, papers, info ? h('span', { class: 'count', text: `${info.notes} ${info.notes === 1 ? 'note' : 'notes'}` }) : null));
    btn.style.setProperty('--i', d);
    if (!future) {
      btn.onclick = () => go(`/day/${day}`);
      btn.onmouseenter = () => peek(btn, day, info);
      btn.onmouseleave = () => { $('#calPeek').hidden = true; };
    }
    cells.push(btn);
  }
  $('#calGrid').replaceChildren(...cells);
  setCalMode(calMode);
}

// The dotted trail between day nodes: solid-ish up to today, faint after.
function drawTrail() {
  const host = $('#calMap');
  if (host.hidden || !host.offsetParent) return;
  const box = host.getBoundingClientRect();
  const svg = $('#mapPath');
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  const nodes = $$('.node', host);
  const pts = nodes.map((n) => {
    const r = n.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, col: Number(n.style.gridColumn.split(' ')[0]) - 1, day: n.dataset.day };
  });
  const seg = (from, to) => {
    let d = `M${pts[from].x},${pts[from].y}`;
    for (let i = from + 1; i <= to; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Math.abs(a.y - b.y) < 4) d += ` L${b.x},${b.y}`;
      else {
        const side = a.col >= 6 ? 1 : -1;
        const k = Math.min(52, box.width * 0.06);
        d += ` C${a.x + side * k},${a.y} ${b.x + side * k},${b.y} ${b.x},${b.y}`;
      }
    }
    return d;
  };
  let split = pts.findIndex((p) => p.day >= S.cfg.today);
  if (split === -1) split = pts.length - 1;
  const [done, todo] = $$('.trail', svg);
  done.setAttribute('d', pts.length && split > 0 ? seg(0, split) : '');
  todo.setAttribute('d', pts.length && split < pts.length - 1 ? seg(split, pts.length - 1) : '');
}
window.addEventListener('resize', () => { if (S.view === 'calendar') drawTrail(); });

function peek(btn, day, info) {
  if (matchMedia('(hover: none)').matches) return;
  const p = $('#calPeek');
  p.replaceChildren(
    h('b', { text: fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' }) }),
    h('p', { text: info?.preview ? `“${info.preview}${info.preview.length >= 90 ? '…' : ''}”` : day === S.cfg.today ? 'Nothing yet. Be the first.' : 'A quiet day.' }),
    info ? h('p', { class: 'peek-meta', text: `${info.notes} ${info.notes === 1 ? 'note' : 'notes'} · ${info.replies} ${info.replies === 1 ? 'reply' : 'replies'}${day === S.cfg.today ? '' : ' · archived'}` }) : null,
  );
  p.hidden = false;
  const host = $('.cal-main').getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  p.style.left = `${Math.max(0, Math.min(b.left - host.left + b.width / 2 - 125, host.width - 250))}px`;
  p.style.top = `${b.bottom - host.top + 12}px`;
}
function shiftMonth(n) {
  const [y, m] = S.calMonth.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  S.calMonth = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar().then(() => requestAnimationFrame(drawTrail));
}
$('#calPrev').onclick = () => shiftMonth(-1);
$('#calNext').onclick = () => shiftMonth(1);

// ---------------------------------------------------------------- 4. board

const viewport = $('#viewport');
const world = $('#world');
const noteLayer = $('#noteLayer');
const stickerLayer = $('#stickerLayer'); // above the notes, so stickers can go on top of them

async function showBoard(day) {
  renderMe();
  if (day > S.cfg.today) {
    toast('That day hasn’t happened yet.');
    return go('today', { replace: true });
  }
  if (day !== S.day || !S.notes.size) await loadBoard(day);
}

async function loadBoard(day) {
  let data;
  try {
    data = await api('GET', `/api/board?day=${day}`);
  } catch (e) {
    toast(e.message);
    return;
  }
  S.day = data.day;
  S.archived = data.archived;
  S.cfg.today = data.today;
  S.chain = null;
  clearCursors();
  for (const el of [...S.noteEls.values(), ...S.stickerEls.values()]) el.remove();
  S.notes.clear(); S.stickers.clear(); S.noteEls.clear(); S.stickerEls.clear();
  for (const s of data.stickers) upsertSticker(s);
  for (const n of data.notes) upsertNote(n);
  renderDayNav();
  updateTools();
  updateEmpty();
  fitView(false);
}

// After a dropped connection: quietly catch up without rebuilding the board or moving the camera.
async function syncBoard() {
  if (S.view !== 'board' || !S.day) return;
  let data;
  try {
    data = await api('GET', `/api/board?day=${S.day}`);
  } catch {
    return;
  }
  if (data.day !== S.day) return;
  const noteIds = new Set(data.notes.map((n) => n.id));
  const stickerIds = new Set(data.stickers.map((x) => x.id));
  for (const id of [...S.notes.keys()]) if (!noteIds.has(id)) removeItem('note', id);
  for (const id of [...S.stickers.keys()]) if (!stickerIds.has(id)) removeItem('sticker', id);
  for (const x of data.stickers) upsertSticker(x);
  for (const n of data.notes) upsertNote(n);
  updateEmpty();
}

function renderDayNav() {
  const isToday = S.day === S.cfg.today;
  const narrow = innerWidth < 520;
  $('#dayText').textContent = isToday
    ? `Today, ${fmtDay(S.day, { day: 'numeric', month: narrow ? 'short' : 'long' })}`
    : fmtDay(S.day, narrow ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'long' });
  $('#archivedBadge').hidden = isToday;
  $('#nextDay').disabled = isToday;
  $('#archiveBanner').hidden = !S.archived;
}
$('#prevDay').onclick = () => go(`/day/${shiftDay(S.day, -1)}`);
$('#nextDay').onclick = () => go(`/day/${shiftDay(S.day, 1)}`);

function updateTools() {
  const ok = canPost();
  $('#newNoteBtn').disabled = !ok;
  for (const b of $$('[data-tray]')) b.disabled = !ok;
  $('#drawBtn').disabled = !ok;
  if (!ok) {
    closeTray();
    stopPlacing();
    setPen(false);
  }
}

function updateEmpty() {
  const empty = S.notes.size === 0;
  $('#empty').hidden = !empty;
  if (!empty) return;
  $('.empty-title').textContent = S.archived ? 'A quiet day.' : 'A blank page.';
  $('.empty-sub').textContent = S.archived ? 'Nothing was pinned on this day.' : 'Be the first to write something today. Someone will write back.';
}

// Stable per-note "randomness" so every viewer sees the same pin colour, curl and drift.
function hashOf(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return x >>> 0;
}
const PIN_COLORS = ['#d4574e', '#e0a43a', '#4f9b6a', '#4b7fcf', '#9a6fd0', '#ece7de'];
const TAPE_COLORS = ['rgba(255,255,255,.55)', 'rgba(196,226,170,.62)', 'rgba(244,190,208,.62)', 'rgba(250,224,150,.62)', 'rgba(190,212,245,.62)'];
const noteSize = (text) => (text.length < 70 ? 's' : text.length < 200 ? 'm' : 'l');
const NOTE_W = { s: 220, m: 250, l: 290 };
let topZ = 10;
function bringToFront(el) { el.style.zIndex = ++topZ; }

function upsertNote(n) {
  S.notes.set(n.id, n);
  let el = S.noteEls.get(n.id);
  if (!el) {
    el = h('article', { class: 'note', tabindex: '0', role: 'button' },
      h('header', { class: 'note-head' }, h('span', { class: 'avatar' }), h('span', { class: 'note-name' }), h('time')),
      h('p', { class: 'note-text' }),
      h('footer', { class: 'note-foot' }, h('span', { class: 'replies' }), h('span', { class: 'open-hint', text: 'Open' })),
    );
    el.dataset.id = n.id;
    const hv = hashOf(n.id);
    const fastener = n.fastener || 'pin';
    if (fastener === 'pin') {
      const pin = h('span', { class: 'pin', 'aria-hidden': 'true' });
      pin.style.setProperty('--pin', PIN_COLORS[hv % PIN_COLORS.length]);
      el.prepend(pin);
    } else if (fastener === 'tape') {
      const tape = h('span', { class: 'tape', 'aria-hidden': 'true' });
      tape.style.setProperty('--tape', TAPE_COLORS[hv % TAPE_COLORS.length]);
      tape.style.setProperty('--tape-rot', `${(hv % 9) - 4}deg`);
      el.prepend(tape);
    }
    el.append(h('span', { class: 'sel', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('span', { class: 'sel-tag' })));
    el.classList.add(`paper-${n.paper || 'plain'}`, `hold-${fastener}`);
    if (hv % 3 === 0) el.classList.add('curl');
    el.style.setProperty('--fd', `${6 + (hv % 5)}s`);
    el.style.setProperty('--fdl', `-${hv % 7}s`);
    bindDraggable(el, 'note');
    el.addEventListener('animationend', (e) => { if (e.animationName === 'settle') el.classList.remove('fresh'); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(n.id); } });
    noteLayer.append(el);
    S.noteEls.set(n.id, el);
  }
  el.dataset.color = n.color;
  el.dataset.size = noteSize(n.text);
  el.classList.toggle('pending', !!n.pending);
  el.classList.toggle('keep-clear', !!n.keepClear);
  el.title = n.keepClear ? 'The writer asked to keep this note clear of doodles' : '';
  if (!el.classList.contains('dragging')) { // a note in someone's hand isn't yanked by updates from others
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
  }
  el.style.setProperty('--rot', `${n.rot}deg`);
  setAvatar($('.avatar', el), n);
  $('.note-name', el).replaceChildren(displayName(n), ...(n.mine ? [h('span', { class: 'you', text: 'you' })] : []));
  const t = $('time', el);
  t.textContent = timeAgo(n.createdAt);
  t.dateTime = new Date(n.createdAt).toISOString();
  $('.note-text', el).textContent = n.text;
  const rc = n.replyCount;
  $('.react-sum', el)?.remove();
  const sum = reactSummary(n.reactions);
  if (sum && !n.pending) $('.note-foot', el).prepend(sum);
  if (n.reactions) S.reacts.set(reactKey('note', n.id), n.reactions);
  $('.replies', el).replaceChildren(...(n.pending
    ? [icon('clock'), 'Waiting for approval']
    : [icon('message'), rc ? `${rc} ${rc === 1 ? 'reply' : 'replies'}` : S.archived ? 'No replies' : 'Write back']));
  $('.sel-tag', el).textContent = n.pending ? `${displayName(n)} \u00b7 waiting` : `${displayName(n)} \u00b7 ${rc} ${rc === 1 ? 'reply' : 'replies'}`;
  el.setAttribute('aria-label', `Note from ${displayName(n)}: ${n.text.slice(0, 80)}`);
  scheduleMinimap();
  if (!$('#listPanel').hidden) renderList();
  return el;
}

function upsertSticker(s) {
  S.stickers.set(s.id, s);
  let el = S.stickerEls.get(s.id);
  if (!el) {
    el = h('div', { class: `sticker ${s.kind}`, role: 'img' });
    el.dataset.id = s.id;
    if (s.kind === 'doodle') el.append(doodleEl(s.content));
    else if (s.kind === 'emoji') el.append(h('span', { class: 'emo', text: s.content }));
    else if (s.kind === 'word') el.append(wordTile(wordParts(s.content), s.id));
    else if (s.kind === 'line') el.append(lineSvg(JSON.parse(s.content)));
    else if (s.kind === 'magnet') el.append(h('span', { class: 'img-magnet' }, h('img', { src: s.content, alt: 'A magnet someone made', draggable: 'false' })));
    else el.append(h('img', { src: s.content, alt: 'A sticker someone made', draggable: 'false' }));
    el.setAttribute('aria-label', s.kind === 'image' ? 'Hand-made sticker' : s.kind === 'line' ? 'A drawn line' : s.content);
    bindDraggable(el, 'sticker');
    stickerLayer.append(el);
    S.stickerEls.set(s.id, el);
  }
  el.classList.toggle('pending', !!s.pending);
  el.title = s.pending ? 'Waiting for approval. Only you can see this for now.' : '';
  el.style.left = `${s.x}px`;
  el.style.top = `${s.y}px`;
  if (s.kind !== 'word' && s.kind !== 'line') {
    el.style.width = el.style.height = `${s.size}px`;
    el.style.fontSize = `${s.size * 0.8}px`;
  }
  el.style.setProperty('--rot', `${s.rot}deg`);
  return el;
}

// ---------------------------------------------------------------- squiggly lines

const LINE_PAD = 10;
function linePath(pts) {
  if (pts.length < 3) return `M${pts.map((p) => p.join(',')).join(' L')}`;
  // smooth curve through the midpoints, so freehand lines look soft rather than jagged
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}
// Each brush is a few layered strokes on the same smooth path: no SVG filters, so every
// browser (Safari and phones included) draws them the same way, and fast.
const BRUSH_WIDTH = { pen: 1, pencil: 0.3, crayon: 1.4, highlighter: 2.6, paint: 1.5 };
const brushWidth = (b, w) => Math.max(1.2, Math.round(w * (BRUSH_WIDTH[b] ?? 1) * 10) / 10);
// A tiny tile of grain in the line's colour, used as the stroke "paint". Patterns render the
// same in every browser, unlike SVG filters.
let patternCount = 0;
function grain(svg, color, { size = 8, cell = 1, density = 0.7, minO = 0.55, maxO = 1 }) {
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS(SVG, 'defs'); svg.prepend(defs); }
  const pat = document.createElementNS(SVG, 'pattern');
  const id = `grain-${++patternCount}`;
  pat.setAttribute('id', id);
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', size);
  pat.setAttribute('height', size);
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      if (Math.random() > density) continue; // a gap where the paper shows through
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', cell);
      r.setAttribute('height', cell);
      r.setAttribute('fill', color);
      r.setAttribute('fill-opacity', (minO + Math.random() * (maxO - minO)).toFixed(2));
      pat.append(r);
    }
  }
  defs.append(pat);
  return `url(#${id})`;
}
const lighten = (hex, t) => {
  const n = parseInt(hex.slice(1), 16);
  return `#${[16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) + (255 - ((n >> sh) & 255)) * t).toString(16).padStart(2, '0')).join('')}`;
};
function brushLayers(b, w, c, svg) {
  switch (b) {
    case 'pencil': // graphite grain, with a faint second pass beside it like a real sketch
      return [
        { w: Math.max(1.4, w), stroke: grain(svg, c, { size: 6, density: 0.62, minO: 0.45, maxO: 0.95 }) },
        { w: Math.max(0.8, w * 0.6), o: 0.35, dx: 0.7, dy: 0.6, stroke: grain(svg, c, { size: 5, density: 0.5 }) },
      ];
    case 'crayon': // waxy colour with little gaps, and rough edges from offset passes
      return [
        { w, stroke: grain(svg, c, { size: 8, density: 0.72, minO: 0.6 }) },
        { w: w * 0.8, dx: w * 0.12, dy: -w * 0.1, stroke: grain(svg, c, { size: 7, density: 0.55, minO: 0.5 }) },
        { w: w * 0.55, dx: -w * 0.1, dy: w * 0.14, stroke: grain(svg, lighten(c, 0.12), { size: 5, density: 0.45, minO: 0.4 }) },
      ];
    case 'paint': // watercolour: a faint wash, a main pass and offset glazes, uneven like real paint
      return [
        { w: w * 1.6, o: 0.1 },
        { w, o: 0.42 },
        { w: w * 0.85, o: 0.24, dx: 1.4, dy: -0.9 },
        { w: w * 0.45, o: 0.22, stroke: lighten(c, 0.2), dx: -0.6, dy: 0.5 },
      ];
    case 'highlighter':
      return [{ w, o: 0.38, cap: 'butt' }];
    default: // pen
      return [{ w, o: 1 }];
  }
}
function brushPaths(c, w, b, svg) {
  return brushLayers(b, w, c, svg).map((l) => {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('class', 'line-ink');
    path.setAttribute('stroke', l.stroke || c);
    path.setAttribute('stroke-width', l.w);
    if (l.o != null) path.setAttribute('stroke-opacity', l.o);
    if (l.cap) path.setAttribute('stroke-linecap', l.cap);
    if (l.dx || l.dy) path.setAttribute('transform', `translate(${l.dx || 0} ${l.dy || 0})`);
    return path;
  });
}
function lineSvg({ p, c, w, b = 'pen' }) {
  const maxX = Math.max(...p.map((pt) => pt[0]));
  const maxY = Math.max(...p.map((pt) => pt[1]));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', maxX + LINE_PAD * 2);
  svg.setAttribute('height', maxY + LINE_PAD * 2);
  svg.setAttribute('viewBox', `${-LINE_PAD} ${-LINE_PAD} ${maxX + LINE_PAD * 2} ${maxY + LINE_PAD * 2}`);
  svg.setAttribute('class', `brush-svg-${b}`);
  const d = linePath(p);
  const hit = document.createElementNS(SVG, 'path'); // wider invisible stroke, easier to grab
  hit.setAttribute('d', d);
  hit.setAttribute('class', 'line-hit');
  hit.setAttribute('stroke-width', w * 1.9 + 14);
  svg.append(hit);
  for (const path of brushPaths(c, w, b, svg)) {
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const pen = { on: false, color: null, w: 6, brush: store.get('kb_brush') || 'pen', stroke: null };
for (const b of $$('.pen-brush')) {
  b.setAttribute('aria-checked', String(b.dataset.brush === pen.brush));
  b.onclick = () => {
    pen.brush = b.dataset.brush;
    store.set('kb_brush', pen.brush);
    for (const o of $$('.pen-brush')) o.setAttribute('aria-checked', String(o === b));
  };
}
function setPen(on) {
  pen.on = on && canPost();
  $('#penBar').hidden = !pen.on;
  $('#drawBtn').setAttribute('aria-pressed', String(pen.on));
  viewport.classList.toggle('drawing', pen.on);
  if (pen.on) {
    closeTray();
    closeThread();
    stopPlacing();
  }
}
$('#drawBtn').onclick = () => setPen(!pen.on);
$('#penDone').onclick = () => setPen(false);
for (const b of $$('.pen-size')) {
  b.onclick = () => {
    pen.w = Number(b.dataset.w);
    for (const o of $$('.pen-size')) o.setAttribute('aria-checked', String(o === b));
  };
}
function renderPenColors() {
  pen.color = pen.color || S.cfg.lineColors[0];
  $('.pen-colors').replaceChildren(...S.cfg.lineColors.map((c) => {
    const b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-label': `Color ${c}`, 'aria-checked': String(c === pen.color) });
    b.style.background = c;
    b.onclick = () => {
      pen.color = c;
      for (const o of $$('.pen-colors .swatch')) o.setAttribute('aria-checked', String(o === b));
    };
    return b;
  }));
}
function penDown(e) {
  const p = toWorld(e.clientX, e.clientY);
  const live = document.createElementNS(SVG, 'svg');
  live.setAttribute('class', 'line-live');
  live.classList.add(`brush-svg-${pen.brush}`);
  const paths = brushPaths(pen.color, brushWidth(pen.brush, pen.w), pen.brush, live);
  live.append(...paths);
  stickerLayer.append(live);
  pen.stroke = { pts: [[p.x, p.y]], live, paths };
  viewport.setPointerCapture(e.pointerId);
}
function penMove(e) {
  if (!pen.stroke) return;
  const p = toWorld(e.clientX, e.clientY);
  const last = pen.stroke.pts[pen.stroke.pts.length - 1];
  if (Math.hypot(p.x - last[0], p.y - last[1]) < 2.5) return;
  pen.stroke.pts.push([p.x, p.y]);
  const d = linePath(pen.stroke.pts);
  for (const path of pen.stroke.paths) path.setAttribute('d', d);
}
async function penUp() {
  const st = pen.stroke;
  pen.stroke = null;
  if (!st) return;
  let pts = st.pts;
  if (pts.length < 2) { st.live.remove(); return; }
  if (pts.length > 600) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 600) === 0);
  const minX = Math.min(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const rel = pts.map(([x, y]) => [Math.round(x - minX), Math.round(y - minY)]);
  try {
    const { sticker } = await api('POST', '/api/stickers', { kind: 'line', content: { p: rel, c: pen.color, w: brushWidth(pen.brush, pen.w), b: pen.brush }, x: minX, y: minY });
    upsertSticker(sticker);
  } catch (err) {
    toast(err.message);
    handlePostErrors(err);
  } finally {
    st.live.remove();
  }
}

function removeItem(type, id) {
  scheduleMinimap();
  if (!$('#listPanel').hidden && type === 'note') setTimeout(renderList);
  if (type === 'note') {
    S.noteEls.get(id)?.remove();
    S.noteEls.delete(id);
    S.notes.delete(id);
    if (S.openNote === id) {
      closeThread();
      toast('That note is no longer on the board.');
    }
    updateEmpty();
  } else if (type === 'sticker') {
    S.stickerEls.get(id)?.remove();
    S.stickerEls.delete(id);
    S.stickers.delete(id);
    if (S.chain?.id === id) S.chain = null;
  } else if (type === 'reply') {
    $(`.reply[data-id="${CSS.escape(id)}"]`)?.remove();
    updateRepliesLabel();
  }
}

// ---------------------------------------------------------------- camera: pan, zoom, momentum

function applyCam() {
  const { x, y, z } = S.cam;
  world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
  world.style.setProperty('--inv', 1 / z); // keeps cursor name tags the same size at any zoom
  $('#zoomReset').textContent = `${Math.round(z * 100)}%`;
  scheduleMinimap();
}

// ---------------------------------------------------------------- minimap

const NOTE_FILL = { butter: '--n-butter', blush: '--n-blush', lime: '--n-lime', lilac: '--n-lilac', sky: '--n-sky', peach: '--n-peach' };
let miniQueued = false;
function scheduleMinimap() {
  if (miniQueued) return;
  miniQueued = true;
  requestAnimationFrame(drawMinimap);
}
function miniFrame() {
  // frame the area that has content (plus the current view), not the whole huge board
  const notes = [...S.notes.values()];
  const tl = toWorld(0, 0);
  const br = toWorld(innerWidth, innerHeight);
  const xs = [tl.x, br.x, ...notes.flatMap((n) => [n.x, n.x + 290])];
  const ys = [tl.y, br.y, ...notes.flatMap((n) => [n.y, n.y + 270])];
  const pad = 120;
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad, tl, br };
}
function drawMinimap() {
  miniQueued = false;
  const canvas = $('#minimap canvas');
  if (!S.cfg || S.view !== 'board' || !canvas.offsetParent) return;
  const ctx2 = canvas.getContext('2d');
  const f = miniFrame();
  const k = Math.min(canvas.width / (f.x1 - f.x0), canvas.height / (f.y1 - f.y0));
  const ox = (canvas.width - (f.x1 - f.x0) * k) / 2;
  const oy = (canvas.height - (f.y1 - f.y0) * k) / 2;
  S.mini = { f, k, ox, oy };
  const css = getComputedStyle(document.documentElement);
  ctx2.clearRect(0, 0, canvas.width, canvas.height);
  for (const n of S.notes.values()) {
    ctx2.fillStyle = css.getPropertyValue(NOTE_FILL[n.color] || '--n-butter').trim() || '#fbf0c4';
    ctx2.fillRect(ox + (n.x - f.x0) * k, oy + (n.y - f.y0) * k, NOTE_W[noteSize(n.text)] * k, 230 * k);
  }
  ctx2.strokeStyle = css.getPropertyValue('--lav').trim() || '#8f88ee';
  ctx2.lineWidth = 3;
  ctx2.strokeRect(ox + (f.tl.x - f.x0) * k, oy + (f.tl.y - f.y0) * k, (f.br.x - f.tl.x) * k, (f.br.y - f.tl.y) * k);
}
$('#minimap').addEventListener('click', (e) => {
  if (!S.mini) return;
  const r = e.currentTarget.getBoundingClientRect();
  const cx = ((e.clientX - r.left) / r.width) * $('#minimap canvas').width;
  const cy = ((e.clientY - r.top) / r.height) * $('#minimap canvas').height;
  const { f, k, ox, oy } = S.mini;
  animateCam(camFor(f.x0 + (cx - ox) / k, f.y0 + (cy - oy) / k, S.cam.z), 500);
});

// ---------------------------------------------------------------- list view

function renderList() {
  const notes = [...S.notes.values()].sort((a, b) => b.createdAt - a.createdAt);
  $('#listLabel').textContent = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;
  $('#listItems').replaceChildren(...(notes.length ? notes.map((n) => {
    const bar = h('span', { class: 'swatch-bar' });
    bar.dataset.color = n.color;
    const rc = n.replyCount;
    return h('li', {}, h('button', { class: 'list-item', type: 'button', onclick: () => {
      if (innerWidth < 760) closeList();
      animateCam(camFor(n.x + 130 + (innerWidth > 760 ? 210 : 0), n.y + 110, Math.max(S.cam.z, 0.9)));
      openThread(n.id);
    } }, bar, h('div', {}, h('b', {}, displayName(n), h('span', { text: n.pending ? 'waiting' : `${rc} ${rc === 1 ? 'reply' : 'replies'}` })), h('p', { text: n.text }))));
  }) : [h('li', { class: 'no-replies', text: 'No notes on this day yet.' })]));
}
function closeList() {
  $('#listPanel').hidden = true;
  $('#listBtn').setAttribute('aria-expanded', 'false');
}
$('#listBtn').onclick = () => {
  const panel = $('#listPanel');
  if (!panel.hidden) return closeList();
  closeTray();
  renderList();
  panel.hidden = false;
  $('#listBtn').setAttribute('aria-expanded', 'true');
};
$('#listClose').onclick = closeList;

// ---------------------------------------------------------------- live cursors

const cursors = new Map();
const cursorLayer = $('#cursors');
let lastSent = 0;
let lastPos = null;
let pendingCursor = null;
let cursorInFlight = false;
function sendCursor(payload) {
  const t = performance.now();
  if (!payload.gone && lastPos && Math.hypot(payload.x - lastPos.x, payload.y - lastPos.y) < 4) return;
  if (cursorInFlight || t - lastSent < 180) {
    clearTimeout(pendingCursor);
    pendingCursor = setTimeout(() => sendCursor(payload), 180);
    return;
  }
  lastSent = t;
  lastPos = payload;
  cursorInFlight = true;
  fetch('/api/cursor', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-kindboard': '1' }, body: JSON.stringify(payload) })
    .catch(() => {})
    .finally(() => { cursorInFlight = false; });
}
viewport.addEventListener('pointermove', (e) => {
  if (S.view !== 'board' || !S.me || e.pointerType === 'touch') return;
  const p = toWorld(e.clientX, e.clientY);
  sendCursor({ day: S.day, x: Math.round(p.x), y: Math.round(p.y) });
});
viewport.addEventListener('pointerleave', () => { if (S.view === 'board' && S.me) sendCursor({ day: S.day, x: 0, y: 0, gone: true }); });
function showCursor(c) {
  if (c.mine || c.day !== S.day) return;
  let entry = cursors.get(c.tag);
  if (c.gone) {
    entry?.el.remove();
    cursors.delete(c.tag);
    return;
  }
  if (!entry) {
    const el = h('div', { class: 'cursor' });
    const arrow = document.createElementNS(SVG, 'svg');
    arrow.setAttribute('viewBox', '0 0 16 16');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M2 1.5 14 7l-5.2 1.6L6.6 14z');
    arrow.append(path);
    el.append(arrow, h('span', { class: 'cursor-name' }));
    cursorLayer.append(el);
    entry = { el };
    cursors.set(c.tag, entry);
  }
  entry.el.style.setProperty('--cc', c.color);
  entry.el.querySelector('.cursor-name').textContent = c.name;
  entry.el.style.left = `${c.x}px`;
  entry.el.style.top = `${c.y}px`;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { entry.el.remove(); cursors.delete(c.tag); }, 8000);
}
function clearCursors() {
  for (const { el } of cursors.values()) el.remove();
  cursors.clear();
}

// ---------------------------------------------------------------- board surface (per viewer)

const prefersDark = matchMedia('(prefers-color-scheme: dark)');
function currentTheme() {
  return document.documentElement.dataset.theme || (prefersDark.matches ? 'dark' : 'light');
}
function paintThemeButtons() {
  const dark = currentTheme() === 'dark';
  for (const b of $$('[data-theme-toggle]')) {
    b.querySelector('use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
    b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    b.title = dark ? 'Light theme' : 'Dark theme';
  }
}
function setTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  paintThemeButtons();
}
setTheme(store.get('kb_theme'));
prefersDark.addEventListener('change', paintThemeButtons);
for (const b of $$('[data-theme-toggle]')) {
  b.onclick = (e) => {
    e.stopPropagation();
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    store.set('kb_theme', next);
    setTheme(next);
  };
}

const SURFACES = ['dots', 'cork', 'plain'];
function setSurface(name) {
  $('#board').dataset.surface = name;
  store.set('kb_surface', name);
}
setSurface(store.get('kb_surface') || 'dots');
$('#surfaceBtn').onclick = () => {
  const next = SURFACES[(SURFACES.indexOf($('#board').dataset.surface) + 1) % SURFACES.length];
  setSurface(next);
  toast({ dots: 'Dotted paper', cork: 'Cork board', plain: 'Plain' }[next]);
};
const toWorld = (cx, cy) => ({ x: (cx - S.cam.x) / S.cam.z, y: (cy - S.cam.y) / S.cam.z });
function zoomAt(cx, cy, factor) {
  const z = Math.min(2, Math.max(0.3, S.cam.z * factor));
  const p = toWorld(cx, cy);
  S.cam = { x: cx - p.x * z, y: cy - p.y * z, z };
  applyCam();
}
let camAnim = null;
function animateCam(target, ms = 650) {
  cancelAnimationFrame(camAnim);
  const from = { ...S.cam };
  const t0 = performance.now();
  const ease = (t) => 1 - (1 - t) ** 4;
  const step = (t) => {
    const k = ease(Math.min(1, (t - t0) / ms));
    S.cam = { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, z: from.z + (target.z - from.z) * k };
    applyCam();
    if (k < 1) camAnim = requestAnimationFrame(step);
  };
  camAnim = requestAnimationFrame(step);
}
function camFor(wx, wy, z) {
  return { x: innerWidth / 2 - wx * z, y: innerHeight / 2 - wy * z, z };
}
function fitView(animate = true) {
  const items = [...S.notes.values()];
  let target;
  if (!items.length) target = camFor(S.cfg.boardW / 2, S.cfg.boardH / 2, 1);
  else {
    const minX = Math.min(...items.map((n) => n.x));
    const minY = Math.min(...items.map((n) => n.y));
    const maxX = Math.max(...items.map((n) => n.x + 260));
    const maxY = Math.max(...items.map((n) => n.y + 200));
    const z = Math.min(1, Math.max(innerWidth < 520 ? 0.62 : 0.4, Math.min((innerWidth - 80) / (maxX - minX), (innerHeight - 220) / (maxY - minY))));
    target = camFor((minX + maxX) / 2, (minY + maxY) / 2 + 12 / z, z);
  }
  if (animate) animateCam(target);
  else {
    S.cam = target;
    applyCam();
  }
}

const pointers = new Map();
let pan = null;
let pinch = null;
let momentum = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.note, .sticker')) return;
  cancelAnimationFrame(camAnim);
  cancelAnimationFrame(momentum);
  hidePopovers();
  if (S.placing) return placeAt(e.clientX, e.clientY);
  if (pen.on) return penDown(e);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  viewport.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.cam.z };
    pan = null;
  } else {
    pan = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y, vx: 0, vy: 0, t: performance.now(), lx: e.clientX, ly: e.clientY };
    viewport.classList.add('panning');
  }
});
viewport.addEventListener('pointermove', (e) => {
  if (pen.stroke) return penMove(e);
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.z * (d / pinch.d)) / S.cam.z);
  } else if (pan) {
    const t = performance.now();
    const dt = Math.max(1, t - pan.t);
    pan.vx = 0.8 * ((e.clientX - pan.lx) / dt) + 0.2 * pan.vx;
    pan.vy = 0.8 * ((e.clientY - pan.ly) / dt) + 0.2 * pan.vy;
    pan.t = t; pan.lx = e.clientX; pan.ly = e.clientY;
    S.cam.x = pan.cx + e.clientX - pan.x;
    S.cam.y = pan.cy + e.clientY - pan.y;
    applyCam();
  }
});
const endPointer = (e) => {
  if (pen.stroke) return penUp();
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) {
    viewport.classList.remove('panning');
    if (pan && performance.now() - pan.t < 80) glide(pan.vx * 16, pan.vy * 16);
    pan = null;
  }
};
function glide(vx, vy) {
  const step = () => {
    vx *= 0.93;
    vy *= 0.93;
    S.cam.x += vx;
    S.cam.y += vy;
    applyCam();
    if (Math.hypot(vx, vy) > 0.3) momentum = requestAnimationFrame(step);
  };
  momentum = requestAnimationFrame(step);
}
viewport.addEventListener('pointerup', endPointer);
viewport.addEventListener('pointercancel', endPointer);
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  cancelAnimationFrame(camAnim);
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else {
    S.cam.x -= e.deltaX;
    S.cam.y -= e.deltaY;
    applyCam();
  }
}, { passive: false });
const zoomBy = (f) => {
  const p = toWorld(innerWidth / 2, innerHeight / 2);
  const z = Math.min(2, Math.max(0.3, S.cam.z * f));
  animateCam(camFor(p.x, p.y, z), 350);
};
$('#zoomIn').onclick = () => zoomBy(1.25);
$('#zoomOut').onclick = () => zoomBy(0.8);
$('#zoomReset').onclick = () => fitView();

// Notes & stickers: tap to open / show a menu; your own can be dragged (today only).
function bindDraggable(el, type) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    hidePopovers();
    if (S.placing) return placeAt(e.clientX, e.clientY);
    if (pen.on) return penDown(e);
    const item = (type === 'note' ? S.notes : S.stickers).get(el.dataset.id);
    // Anyone can rearrange today's notes; stickers, words and lines move only for whoever placed them.
    const movable = type === 'note' ? canPost() && (!item.pending || item.mine) : item.mine && canPost();
    start = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y, drag: false, can: movable, lx: e.clientX, swing: 0 };
    bringToFront(el);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (pen.stroke) return penMove(e);
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const item = (type === 'note' ? S.notes : S.stickers).get(el.dataset.id);
    const threshold = item?.mine ? 6 : 14; // moving someone else's note takes a deliberate drag
    if (!start.drag && Math.hypot(dx, dy) > threshold && start.can) {
      start.drag = true;
      el.classList.add('dragging');
    }
    if (start.drag) {
      el.style.left = `${start.ix + dx / S.cam.z}px`;
      el.style.top = `${start.iy + dy / S.cam.z}px`;
      // swing like paper hanging from a hand
      start.swing = Math.max(-14, Math.min(14, start.swing * 0.7 + (e.clientX - start.lx) * 0.9));
      start.lx = e.clientX;
      el.style.rotate = `${start.swing}deg`;
    }
  });
  el.addEventListener('pointerup', async (e) => {
    if (pen.stroke) return penUp();
    if (!start) return;
    const s = start;
    start = null;
    const id = el.dataset.id;
    if (!s.drag) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) return;
      if (type === 'note') return openThread(id);
      // Someone else's scribble or sticker on top of a note shouldn't get in the way of reading it:
      // a tap goes through to the note. Your own pieces still open their menu (move/delete).
      const piece = S.stickers.get(id);
      if (!piece?.mine) {
        const under = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest('#noteLayer .note')).find(Boolean);
        if (under) return openThread(under.dataset.id);
      }
      stickerMenu(id, e.clientX, e.clientY);
      return;
    }
    el.classList.remove('dragging');
    el.style.rotate = '';
    const x = s.ix + (e.clientX - s.x) / S.cam.z;
    const y = s.iy + (e.clientY - s.y) / S.cam.z;
    try {
      const res = await api('PATCH', `/api/${type}s/${id}`, { x, y });
      if (type === 'note') upsertNote(res.note);
      else {
        upsertSticker(res.sticker);
        if (res.sticker.kind === 'word') S.chain = { id };
      }
    } catch (err) {
      toast(err.message);
      const item = (type === 'note' ? S.notes : S.stickers).get(id);
      if (item) type === 'note' ? upsertNote(item) : upsertSticker(item);
    }
  });
  el.addEventListener('pointercancel', () => {
    start = null;
    el.style.rotate = '';
    el.classList.remove('dragging');
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (type === 'sticker') stickerMenu(el.dataset.id, e.clientX, e.clientY);
    else noteMenu(el.dataset.id, e.clientX, e.clientY);
  });
}

// ---------------------------------------------------------------- menus & flagging

function showMenu(x, y, items) {
  const menu = $('#menu');
  menu.replaceChildren(...items.map((it) => h('button', {
    role: 'menuitem', class: it.danger ? 'danger' : '',
    onclick: () => { hidePopovers(); it.action(); },
  }, icon(it.icon), it.label)));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(x, innerWidth - r.width - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(y, innerHeight - r.height - 12))}px`;
}
function hidePopovers() {
  $('#menu').hidden = true;
  $('#meMenu').hidden = true;
  $('#skyMenu').hidden = true;
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.popover, [data-me], #skyChip')) hidePopovers(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  hidePopovers();
  if (S.placing) return stopPlacing();
  if (pen.on) return setPen(false);
  if (!document.querySelector('dialog[open]') && S.openNote) closeThread();
});

function itemActions(type, item) {
  const acts = [];
  if (!item.mine) acts.push({ icon: 'flag', label: 'Report', action: () => openFlag(type, item.id) });
  if (item.mine && !S.archived) acts.push({ icon: 'trash', label: 'Delete', danger: true, action: () => deleteItem(type, item.id) });
  return acts;
}
function stickerMenu(id, x, y) {
  const s = S.stickers.get(id);
  const acts = s && itemActions('sticker', s);
  if (acts?.length) showMenu(x, y, acts);
}
function noteMenu(id, x, y) {
  const n = S.notes.get(id);
  showMenu(x, y, [
    { icon: 'message', label: 'Open conversation', action: () => openThread(id) },
    { icon: 'link', label: 'Copy link', action: () => copyNoteLink(id) },
    ...itemActions('note', n),
  ]);
}
async function deleteItem(type, id) {
  const what = { note: 'note and its replies', reply: 'reply', sticker: 'piece' }[type];
  if (!confirm(`Delete this ${what}?`)) return;
  try {
    await api('DELETE', `/api/${type}s/${id}`);
    removeItem(type, id);
  } catch (e) {
    toast(e.message);
  }
}

let flagTarget = null;
function openFlag(type, id) {
  flagTarget = { type, id };
  showError($('#flagDlg'), null);
  $('#flagForm').reset();
  $('#flagDlg').showModal();
}
$('#flagForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = new FormData(e.target).get('reason');
  try {
    await api('POST', '/api/flag', { ...flagTarget, reason });
    $('#flagDlg').close();
    toast('Thanks. A moderator will take a look.', 4000);
  } catch (err) {
    showError($('#flagDlg'), err);
  }
});

// ---------------------------------------------------------------- thread (conversation)

async function openThread(id) {
  S.openNote = id;
  $('#thread').hidden = false;
  $('#board').classList.add('thread-open');
  closeTray();
  history.replaceState({}, '', `/day/${S.day}#${id}`);
  for (const el of S.noteEls.values()) el.classList.toggle('highlight', el.dataset.id === id);
  const local = S.notes.get(id);
  if (local) renderThreadNote(local);
  $('.reply-list').replaceChildren();
  $('.replies-label').textContent = '';
  updateThreadLock();
  try {
    const data = await api('GET', `/api/notes/${id}`);
    if (S.openNote !== id) return;
    renderThreadNote(data.note);
    $('.reply-list').replaceChildren();
    setReplyTo(null);
    for (const r of data.replies) placeReply(replyEl(r), r);
    updateRepliesLabel();
  } catch (e) {
    toast(e.message);
    closeThread();
  }
}

// ---- emoji reactions: a small, kind set, toggled per person
S.reacts = new Map(); // "note:id" / "reply:id" -> { emoji: { n, mine } }
const reactKey = (type, id) => `${type}:${id}`;
function reactSummary(reactions = {}) {
  const top = Object.entries(reactions).filter(([, v]) => v.n > 0).sort((a, b) => b[1].n - a[1].n);
  if (!top.length) return null;
  const total = top.reduce((sum, [, v]) => sum + v.n, 0);
  return h('span', { class: 'react-sum', 'aria-label': `${total} reactions` }, top.slice(0, 3).map(([e]) => e).join(''), ` ${total}`);
}
function reactBar(type, id) {
  const bar = h('div', { class: 'reacts' });
  bar.dataset.react = reactKey(type, id);
  paintReactBar(bar);
  return bar;
}
function paintReactBar(bar) {
  const [type, id] = bar.dataset.react.split(':');
  const data = S.reacts.get(bar.dataset.react) || {};
  const can = canPost() && !S.notes.get(type === 'note' ? id : S.openNote)?.pending;
  const fav = S.cfg.reactions || [];
  const used = Object.keys(data).filter((e) => data[e]?.n > 0)
    .sort((x, y) => (fav.indexOf(x) + 1 || 99) - (fav.indexOf(y) + 1 || 99) || data[y].n - data[x].n); // favourites first, then most used
  const chips = used.map((e) => {
    const b = h('button', { type: 'button', class: `react-chip${data[e].mine ? ' mine' : ''}`, 'aria-pressed': String(!!data[e].mine), 'aria-label': `${e} ${data[e].n}`, disabled: !can }, e, h('span', { text: String(data[e].n) }));
    b.onclick = () => toggleReaction(type, id, e);
    return b;
  });
  const add = h('button', { type: 'button', class: 'react-add', 'aria-label': 'Add a reaction', disabled: !can, title: 'React' }, '\u{1F642}', h('span', { text: '+' }));
  add.onclick = (ev) => {
    ev.stopPropagation();
    openEmojiPicker(ev.currentTarget, (e) => toggleReaction(type, id, e));
  };
  bar.replaceChildren(...chips, ...(can ? [add] : []));
}
// The full picker: the six favourites first, then everything by category, plus "type any emoji".
let pickerGroup = 0;
function openEmojiPicker(anchor, onPick) {
  const pick = $('#menu');
  const choose = (e) => { hidePopovers(); onPick(e); };
  const emojiBtn = (e) => h('button', { type: 'button', class: 'react-opt', text: e, 'aria-label': `React ${e}`, onclick: () => choose(e) });
  const grid = h('div', { class: 'emoji-grid' });
  const tabs = h('div', { class: 'emoji-tabs', role: 'tablist' });
  const showGroup = (i) => {
    pickerGroup = i;
    grid.replaceChildren(...EMOJI_GROUPS[i].emoji.map(emojiBtn));
    grid.scrollTop = 0;
    for (const [j, t] of [...tabs.children].entries()) t.setAttribute('aria-selected', String(j === i));
  };
  tabs.append(...EMOJI_GROUPS.map((g, i) => h('button', { type: 'button', role: 'tab', class: 'emoji-tab', text: g.icon, title: g.name, 'aria-label': g.name, onclick: (e) => { e.stopPropagation(); showGroup(i); } })));
  const own = h('input', { class: 'field sm', placeholder: 'Or type any emoji', maxlength: '24', 'aria-label': 'Type any emoji' });
  const ownForm = h('form', { class: 'emoji-own' }, own, h('button', { type: 'submit', class: 'btn sm subtle', text: 'Add' }));
  ownForm.addEventListener('submit', (e) => { e.preventDefault(); const v = own.value.trim(); if (v) choose(v); });
  pick.replaceChildren(h('div', { class: 'emoji-picker' },
    h('div', { class: 'react-pick' }, ...(S.cfg.reactions || []).map(emojiBtn)),
    tabs, grid, ownForm));
  showGroup(pickerGroup);
  pick.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(340, innerWidth - 24);
  pick.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
  const below = r.bottom + 6;
  pick.style.top = `${below + 380 > innerHeight ? Math.max(12, r.top - 386) : below}px`;
}

async function toggleReaction(type, id, emoji) {
  const key = reactKey(type, id);
  const before = S.reacts.get(key) || {};
  const data = { ...before };
  const was = data[emoji]?.mine;
  data[emoji] = { n: Math.max(0, (data[emoji]?.n || 0) + (was ? -1 : 1)), mine: !was }; // feels instant
  setReactions(type, id, data);
  try {
    const res = await api('POST', '/api/react', { type, id, emoji });
    const fresh = {};
    for (const [e, n] of Object.entries(res.counts)) fresh[e] = { n, mine: e === emoji ? res.mine : !!S.reacts.get(key)?.[e]?.mine };
    setReactions(type, id, fresh);
  } catch (err) {
    setReactions(type, id, before); // the server said no: undo the instant update
    toast(err.message);
  }
}
function setReactions(type, id, data) {
  S.reacts.set(reactKey(type, id), data);
  for (const bar of $$(`[data-react="${CSS.escape(reactKey(type, id))}"]`)) paintReactBar(bar);
  if (type === 'note' && S.notes.has(id)) {
    S.notes.get(id).reactions = data;
    const el = S.noteEls.get(id);
    if (el) $('.react-sum', el)?.remove(), (() => { const sum = reactSummary(data); if (sum) $('.note-foot', el).prepend(sum); })();
  }
}

function renderThreadNote(n) {
  if (n.reactions) S.reacts.set(reactKey('note', n.id), n.reactions);
  const card = $('.thread-note');
  card.dataset.color = n.color;
  const av = h('span', { class: 'avatar' });
  setAvatar(av, n);
  card.replaceChildren(
    h('header', { class: 'note-head' }, av, h('span', { class: 'note-name' }, displayName(n), ...(n.mine ? [h('span', { class: 'you', text: 'you' })] : [])),
      h('time', { text: new Date(n.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })),
    h('p', { class: 'note-text', text: n.text }),
    reactBar('note', n.id),
  );
}

function replyEl(r) {
  const av = h('span', { class: 'avatar' });
  setAvatar(av, r);
  const more = h('button', { class: 'icon-btn', 'aria-label': 'Reply options' }, icon('more'));
  more.onclick = (e) => {
    const acts = itemActions('reply', r);
    const b = e.currentTarget.getBoundingClientRect();
    if (acts.length) showMenu(b.right - 180, b.bottom + 4, acts);
  };
  if (r.reactions) S.reacts.set(reactKey('reply', r.id), r.reactions);
  const replyBtn = h('button', { type: 'button', class: 'reply-to', text: 'Reply' });
  replyBtn.onclick = () => setReplyTo(r);
  const li = h('li', { class: `reply${r.mine ? ' mine' : ''}${r.pending ? ' pending' : ''}${r.parentId ? ' nested' : ''}` },
    av,
    h('div', {},
      h('div', { class: 'reply-meta' }, displayName(r), ...(r.mine ? [h('span', { class: 'you', text: 'you' })] : []), ...(r.pending ? [h('span', { class: 'wait-tag', text: 'Waiting for approval' })] : []), h('time', { text: timeAgo(r.createdAt) }), more),
      h('p', { class: 'reply-text', text: r.text }),
      h('div', { class: 'reply-actions' }, ...(r.pending ? [] : [reactBar('reply', r.id)]), ...(canPost() && !r.pending ? [replyBtn] : [])),
      h('ol', { class: 'reply-children' }),
    ),
  );
  li.dataset.id = r.id;
  return li;
}
// Replies go under the reply they answer (one level deep keeps it easy to follow).
function placeReply(li, r) {
  const parent = r.parentId && $(`.reply[data-id="${CSS.escape(r.parentId)}"] > div > .reply-children`);
  (parent || $('.reply-list')).append(li);
}
function setReplyTo(r) {
  S.replyTo = r ? { id: r.parentId || r.id, name: displayName(r) } : null;
  const chip = $('#replyToChip');
  chip.hidden = !S.replyTo;
  if (S.replyTo) {
    $('#replyToName').textContent = S.replyTo.name;
    replyText.focus();
  }
}

function updateRepliesLabel() {
  const count = $$('.reply-list .reply').length;
  $('.replies-label').textContent = count ? `${count} ${count === 1 ? 'reply' : 'replies'}` : '';
  $('.thread-body .no-replies')?.remove();
  if (!count) {
    $('.reply-list').after(h('p', { class: 'no-replies', text: S.archived ? 'Nobody replied to this one.' : 'No replies yet. A few kind words can change someone’s whole day.' }));
  }
}

function updateThreadLock() {
  const locked = $('.thread-locked');
  const waiting = !!S.notes.get(S.openNote)?.pending;
  const open = canPost() && !waiting;
  $('#replyForm').hidden = !open;
  locked.hidden = open;
  locked.textContent = waiting ? 'This note is waiting for a quick approval. Only you can see it for now, and replies open once it\u2019s approved.' : S.archived ? 'This day is archived. Replies are closed, but you can still read.' : S.me?.banned ? 'Paused identities can’t reply.' : '';
  showError($('#replyForm'), null);
}

function closeThread(updateUrl = true) {
  if (!S.openNote) return;
  S.openNote = null;
  $('#thread').hidden = true;
  $('#board').classList.remove('thread-open');
  for (const el of S.noteEls.values()) el.classList.remove('highlight');
  if (updateUrl && S.view === 'board') history.replaceState({}, '', `/day/${S.day}`);
}
$('#threadClose').onclick = () => closeThread();
$('#threadShare').onclick = () => copyNoteLink(S.openNote);
$('#threadMenu').onclick = (e) => {
  const n = S.notes.get(S.openNote);
  if (!n) return;
  const b = e.currentTarget.getBoundingClientRect();
  const acts = itemActions('note', n);
  if (acts.length) showMenu(b.right - 180, b.bottom + 6, acts);
};
function copyNoteLink(id) {
  copy(`${location.origin}/day/${S.day}#${id}`, 'Link to this note copied');
}

const replyText = $('#replyText');
$('#replyToCancel').onclick = () => setReplyTo(null);
replyText.addEventListener('input', () => autoGrow(replyText));
replyText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#replyForm').requestSubmit(); });
$('#replyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  showError(form, null);
  try {
    const { reply, support, pending } = await api('POST', `/api/notes/${S.openNote}/replies`, { text: replyText.value, parentId: S.replyTo?.id });
    addReply(reply);
    setReplyTo(null);
    if (pending) toast(`Your reply will show for others once it\u2019s approved, because ${pending}.`, 5000);
    replyText.value = '';
    autoGrow(replyText);
    if (support) $('#supportDlg').showModal();
  } catch (err) {
    showError(form, err);
    handlePostErrors(err);
  } finally {
    btn.disabled = false;
  }
});
function addReply(r) {
  if (S.openNote !== r.noteId || $(`.reply[data-id="${CSS.escape(r.id)}"]`)) return;
  placeReply(replyEl(r), r);
  updateRepliesLabel();
  const body = $('.thread-body');
  body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
}
function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}
function openFromHash() {
  const id = location.hash.slice(1);
  const n = id && S.notes.get(id);
  if (!n) return;
  animateCam(camFor(n.x + 130 + (innerWidth > 760 ? 210 : 0), n.y + 100, 1));
  openThread(id);
}

// ---------------------------------------------------------------- composing notes

function renderSwatches() {
  $('.swatches').replaceChildren(...S.cfg.noteColors.map((c) => {
    const b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-label': c, 'aria-checked': String(c === S.composeColor) });
    b.dataset.color = c;
    b.onclick = () => {
      S.composeColor = c;
      $('.compose-note').dataset.color = c;
      for (const s of $$('.swatches .swatch')) s.setAttribute('aria-checked', String(s === b));
    };
    return b;
  }));
}
$('#newNoteBtn').onclick = () => {
  if (!canPost()) return;
  showError($('#composeDlg'), null);
  $('#composeDlg').showModal();
  $('#composeText').focus();
};
$('#composeText').addEventListener('input', (e) => {
  const words = e.target.value.trim().split(/\s+/).filter(Boolean).length;
  $('#composeCount').textContent = words ? `${words} word${words === 1 ? '' : 's'} · no limit` : 'No word limit.';
  store.set('kb_draft', e.target.value);
});
$('#composeText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#composeForm').requestSubmit(); });

const draft = { paper: 'plain', fastener: 'pin', keepClear: store.get('kb_keep_clear') === '1' };
for (const b of $$('[data-clear]')) b.setAttribute('aria-checked', String((b.dataset.clear === '1') === draft.keepClear));
for (const b of $$('[data-clear]')) {
  b.onclick = () => {
    draft.keepClear = b.dataset.clear === '1';
    store.set('kb_keep_clear', draft.keepClear ? '1' : '0');
    for (const o of $$('[data-clear]')) o.setAttribute('aria-checked', String(o === b));
  };
}
for (const b of $$('[data-paper], [data-fastener]')) {
  b.onclick = () => {
    const key = b.dataset.paper ? 'paper' : 'fastener';
    draft[key] = b.dataset[key];
    for (const o of $$(`[data-${key}]`)) o.setAttribute('aria-checked', String(o === b));
    $('.compose-note').dataset.paper = draft.paper;
  };
}

$('#composeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dlg = $('#composeDlg');
  const btn = $('button[type=submit]', dlg);
  btn.disabled = true;
  showError(dlg, null);
  try {
    const text = $('#composeText').value;
    const check = await api('POST', '/api/notes/check', { text }); // kindness check before you carry it to a spot
    dlg.close();
    if (check.pending) toast(`This one will wait for a quick approval because ${check.pending}.`, 5000);
    startPlacing({ kind: 'note', text, color: S.composeColor, ...draft });
  } catch (err) {
    showError(dlg, err);
    handlePostErrors(err);
  } finally {
    btn.disabled = false;
  }
});

async function dropNote(st, cx, cy) {
  const size = noteSize(st.text);
  const p = toWorld(cx, cy);
  try {
    const { note, support, pending } = await api('POST', '/api/notes', {
      text: st.text, color: st.color, paper: st.paper, fastener: st.fastener, keepClear: st.keepClear, x: p.x - NOTE_W[size] / 2, y: p.y - 30,
    });
    const el = upsertNote(note);
    el.classList.add('fresh');
    bringToFront(el);
    updateEmpty();
    $('#composeText').value = '';
    store.set('kb_draft', '');
    if (pending) toast('Placed. Only you can see it until it\u2019s approved.', 5000);
    else toast(note.fastener === 'tape' ? 'Taped up. Someone will see it soon.' : note.fastener === 'pin' ? 'Pinned. Someone will see it soon.' : 'Placed. Someone will see it soon.');
    if (support) $('#supportDlg').showModal();
  } catch (err) {
    $('#composeDlg').showModal();
    showError($('#composeDlg'), err);
    handlePostErrors(err);
  }
}

function handlePostErrors(err) {
  if (err.data?.banned && S.me) {
    S.me.banned = true;
    renderMe();
  }
  if (err.data?.archived) {
    S.archived = true;
    renderDayNav();
    updateTools();
    updateThreadLock();
  }
}

// ---------------------------------------------------------------- tray: words, stickers, my stickers

const tray = $('#tray');
function openTray(tab) {
  closeThread();
  tray.hidden = false;
  for (const t of $$('.tab', tray)) {
    t.classList.toggle('active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  }
  for (const p of $$('[data-panel]', tray)) p.hidden = p.dataset.panel !== tab;
  for (const b of $$('[data-tray]')) b.setAttribute('aria-expanded', String(b.dataset.tray === tab || (tab === 'mine' && b.dataset.tray === 'stickers')));
  if (tab === 'words') loadWords();
  if (tab === 'mine') loadMyStickers();
}
function closeTray() {
  tray.hidden = true;
  for (const b of $$('[data-tray]')) b.setAttribute('aria-expanded', 'false');
}
for (const b of $$('[data-tray]')) {
  b.onclick = () => {
    const tab = b.dataset.tray;
    const current = $('.tab.active', tray)?.dataset.tab;
    if (!tray.hidden && (current === tab || (tab === 'stickers' && current === 'mine'))) closeTray();
    else openTray(tab);
  };
}
for (const t of $$('.tab', tray)) t.onclick = () => openTray(t.dataset.tab);
$('#trayClose').onclick = closeTray;

// Word play: today's jumbled tiles.
// Word tiles: a style (clipping, magnet, plain, pixel, funky, alien, doodle) and a font.
const TILE_STYLES = { clipping: 'Clippings', magnet: 'Magnets', plain: 'Plain', pixel: 'Pixel', funky: 'Funky', alien: 'Alien', doodle: 'Doodle' };
const TILE_FONTS = { auto: 'Auto (match the style)', oldprint: 'Old print', typewriter: 'Typewriter', boldserif: 'Bold serif', classic: 'Classic', rounded: 'Rounded', pixel: 'Pixel', funky: 'Funky', block: 'Block', space: 'Space', hand: 'Handwritten', script: 'Script', clean: 'Clean' };
const MAGNET_COLORS = ['#e4572e', '#f3a712', '#29b6f6', '#66bb6a', '#ab47bc', '#ec407a', '#ffca28', '#26a69a'];
S.wordStyle = TILE_STYLES[store.get('kb_tile_style')] ? store.get('kb_tile_style') : 'clipping';
S.wordFont = TILE_FONTS[store.get('kb_tile_font')] ? store.get('kb_tile_font') : 'auto';
function wordParts(content) {
  if (String(content).startsWith('{')) {
    try { return JSON.parse(content); } catch { /* fall through */ }
  }
  return { t: content, s: 'plain', f: 'auto' }; // tiles placed before styles existed
}
function wordTile({ t, s = 'plain', f = 'auto' }, seed = t) {
  const v = hashOf(String(seed)) % 6;
  const span = h('span', { class: `wt ws-${s} wv-${v} ws-${s}-${v % 3}` });
  if (f && f !== 'auto') span.dataset.font = f;
  if (s === 'magnet') {
    // alphabet magnets: one chunky plastic letter at a time, each its own colour
    [...t].forEach((ch, i) => {
      const letter = h('span', { class: 'ml', text: ch });
      letter.style.setProperty('--mc', MAGNET_COLORS[(i + v) % MAGNET_COLORS.length]);
      letter.style.setProperty('--mr', `${((i * 37 + v * 11) % 9) - 4}deg`);
      span.append(letter);
    });
  } else {
    span.textContent = t;
  }
  return span;
}
let tileFontsLoaded = false;
function ensureTileFonts() {
  if (tileFontsLoaded) return;
  tileFontsLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=Special+Elite&family=Abril+Fatface&family=Old+Standard+TT:wght@400;700&family=Fredoka:wght@600;700&family=Silkscreen&family=Shrikhand&family=Bungee&family=Audiowide&family=Gochi+Hand&family=Caveat:wght@500;700&display=swap' }));
}
function renderWordLooks() {
  $('#wordStyles').replaceChildren(...Object.entries(TILE_STYLES).map(([k, label]) => {
    const b = h('button', { type: 'button', class: 'look-chip', role: 'radio', 'aria-checked': String(k === S.wordStyle), text: label });
    b.onclick = () => { S.wordStyle = k; store.set('kb_tile_style', k); renderWordLooks(); renderWords(); };
    return b;
  }));
  const sel = $('#wordFont');
  if (!sel.options.length) {
    sel.append(...Object.entries(TILE_FONTS).map(([k, label]) => h('option', { value: k, text: label })));
    sel.onchange = () => { S.wordFont = sel.value; store.set('kb_tile_font', sel.value); renderWords(); };
  }
  sel.value = S.wordFont;
}

async function loadWords() {
  ensureTileFonts();
  renderWordLooks();
  if (S.words?.day !== S.day) {
    try {
      const data = await api('GET', `/api/words?day=${S.day}`);
      S.words = { day: S.day, ...data };
    } catch {
      return;
    }
  }
  renderWords();
}
function tileButton(word, glue = false) {
  const b = h('button', { class: 'tile', type: 'button', 'aria-label': `Word tile: ${word}` }, wordTile({ t: word, s: S.wordStyle, f: S.wordFont }));
  b.style.setProperty('--r', `${(Math.random() * 4 - 2).toFixed(1)}deg`);
  b.onclick = () => useWord(word);
  if (glue) b.dataset.glue = '1';
  return b;
}
function renderWords(jumble = false) {
  const words = [...S.words.words];
  if (jumble) {
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
  }
  const tiles = words.map((w) => tileButton(w));
  if (jumble) tiles.forEach((t, i) => { t.classList.add('jumble'); t.style.animationDelay = `${i * 8}ms`; });
  $('#wordBank').replaceChildren(...tiles);
  $('#glueBank').replaceChildren(...S.words.glue.map((w) => tileButton(w, true)));
}
$('#shuffleWords').onclick = () => renderWords(true);
$('#newLine').onclick = () => {
  S.chain = null;
  toast('Tap a word, then tap where the new line should start.');
};
$('#customWord').addEventListener('submit', (e) => {
  e.preventDefault();
  const w = $('#customWordInput').value.trim();
  if (!w) return;
  if (!/^[\p{L}'’-]{1,18}$/u.test(w)) return toast('Tiles are single words, letters only.');
  $('#customWordInput').value = '';
  useWord(w);
});

// Clicking a word continues your current sentence; otherwise you choose where it goes.
function useWord(word) {
  const last = S.chain && S.stickers.get(S.chain.id);
  const lastEl = S.chain && S.stickerEls.get(S.chain.id);
  if (last && lastEl) {
    const tight = /^[-?!.,]/.test(word);
    postSticker({ kind: 'word', content: word, style: S.wordStyle, font: S.wordFont }, last.x + lastEl.offsetWidth + (tight ? 1 : 5), last.y + (Math.random() * 4 - 2));
  } else {
    startPlacing({ kind: 'word', content: word });
  }
}

// Doodles come as paper stickers or glossy fridge magnets.
S.doodleStyle = store.get('kb_doodle_style') === 'magnet' ? 'magnet' : 'sticker';
function renderDoodles() {
  const magnet = S.doodleStyle === 'magnet';
  $('#doodleGrid').replaceChildren(...Object.keys(DOODLES).map((name) => {
    const content = magnet ? `${name}:magnet` : name;
    return h('button', { class: 'sticker-item', type: 'button', 'aria-label': `${name} ${magnet ? 'magnet' : 'sticker'}`, onclick: () => startPlacing({ kind: 'doodle', content }) }, doodleEl(content));
  }));
  for (const b of $$('[data-doodle-style]')) b.setAttribute('aria-checked', String(b.dataset.doodleStyle === S.doodleStyle));
  if (S.myStickers?.length) renderMyStickers();
}
for (const b of $$('[data-doodle-style]')) b.onclick = () => { S.doodleStyle = b.dataset.doodleStyle; store.set('kb_doodle_style', S.doodleStyle); renderDoodles(); };
renderDoodles();

async function loadMyStickers() {
  try {
    S.myStickers = (await api('GET', '/api/my-stickers')).stickers;
  } catch { /* keep the old list */ }
  renderMyStickers();
}
function renderMyStickers() {
  const make = h('button', { class: 'sticker-item make-tile', type: 'button', onclick: openDraw }, icon('pen'), 'Draw or upload');
  $('#mineGrid').replaceChildren(make, ...S.myStickers.map((s) => {
    const del = h('button', { class: 'del', type: 'button', 'aria-label': 'Remove from my collection' }, icon('x'));
    del.onclick = async (e) => {
      e.stopPropagation();
      await api('DELETE', `/api/my-stickers/${s.id}`).catch(() => {});
      S.myStickers = S.myStickers.filter((x) => x.id !== s.id);
      renderMyStickers();
    };
    const preview = S.doodleStyle === 'magnet' ? h('span', { class: 'img-magnet' }, h('img', { src: s.data, alt: '' })) : h('img', { src: s.data, alt: '' });
    return h('div', { class: 'sticker-item', role: 'button', tabindex: '0', 'aria-label': 'Your sticker', onclick: () => startPlacing({ kind: S.doodleStyle === 'magnet' ? 'magnet' : 'image', mine: s.id, content: s.data }) },
      preview, del);
  }));
}

// Placing mode: a ghost follows the pointer until you tap the board.
const ghost = $('#ghost');
function startPlacing(st) {
  S.placing = st;
  closeTray();
  if (st.kind === 'note') {
    const mini = h('div', { class: `note ghost-note paper-${st.paper} hold-${st.fastener}` }, h('p', { class: 'note-text', text: st.text }));
    mini.dataset.color = st.color;
    mini.dataset.size = noteSize(st.text);
    ghost.replaceChildren(mini);
  } else {
    ghost.replaceChildren(st.kind === 'doodle' ? doodleEl(st.content) : st.kind === 'word' ? wordTile({ t: st.content, s: S.wordStyle, f: S.wordFont })
      : st.kind === 'magnet' ? h('span', { class: 'img-magnet' }, h('img', { src: st.content, alt: '' })) : h('img', { src: st.content, alt: '' }));
  }
  ghost.classList.toggle('wordy', st.kind === 'word' || st.kind === 'note');
  ghost.classList.toggle('noteish', st.kind === 'note');
  ghost.style.setProperty('--gz', S.cam.z);
  ghost.hidden = false;
  ghost.style.left = `${innerWidth / 2}px`;
  ghost.style.top = `${innerHeight / 2}px`;
  viewport.classList.add('placing');
  toast(st.kind === 'note' ? 'Move it anywhere and tap to stick it down · Esc to cancel' : st.kind === 'word' ? 'Tap where your sentence should start · Esc to cancel' : 'Tap the board to place it · Esc to cancel');
}
function stopPlacing() {
  S.placing = null;
  ghost.hidden = true;
  ghost.replaceChildren();
  viewport.classList.remove('placing');
}
window.addEventListener('pointermove', (e) => {
  if (!S.placing) return;
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
});
function placeAt(cx, cy) {
  const st = S.placing;
  stopPlacing();
  if (st.kind === 'note') return dropNote(st, cx, cy);
  const p = toWorld(cx, cy);
  if (st.kind === 'word') {
    postSticker({ kind: 'word', content: st.content, style: S.wordStyle, font: S.wordFont }, p.x - 20, p.y - 14).then(() => openTray('words')); // keep building the sentence
    return;
  }
  postSticker(st.kind === 'doodle' ? { kind: 'doodle', content: st.content } : { kind: st.kind, mine: st.mine }, p.x - 38, p.y - 38);
}
async function postSticker(body, x, y) {
  try {
    const { sticker, pending } = await api('POST', '/api/stickers', { ...body, x, y, size: body.kind === 'doodle' ? 80 : 72 });
    if (pending) toast('Hand-made stickers wait for a quick approval. Only you can see it for now.', 5000);
    upsertSticker(sticker).classList.add('fresh');
    if (sticker.kind === 'word') S.chain = { id: sticker.id };
  } catch (err) {
    toast(err.message, 4000);
    handlePostErrors(err);
  }
}

// Draw-your-own sticker
const canvas = $('#drawCanvas');
const ctx = canvas.getContext('2d');
const brush = { color: BRUSH_COLORS[0], eraser: false };
$('.draw-colors').replaceChildren(...BRUSH_COLORS.map((c, i) => {
  const b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-label': `Color ${c}`, 'aria-checked': String(i === 0) });
  b.style.background = c;
  b.onclick = () => {
    brush.color = c;
    brush.eraser = false;
    $('#eraserBtn').setAttribute('aria-pressed', 'false');
    for (const s of $$('.draw-colors .swatch')) s.setAttribute('aria-checked', String(s === b));
  };
  return b;
}));
$('#eraserBtn').onclick = (e) => {
  brush.eraser = !brush.eraser;
  e.currentTarget.setAttribute('aria-pressed', String(brush.eraser));
};
$('#clearBtn').onclick = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
let stroke = null;
const canvasPoint = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
};
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  stroke = canvasPoint(e);
  drawTo(stroke);
});
canvas.addEventListener('pointermove', (e) => { if (stroke) drawTo(canvasPoint(e)); });
canvas.addEventListener('pointerup', () => { stroke = null; });
function drawTo(p) {
  ctx.globalCompositeOperation = brush.eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = brush.color;
  ctx.lineWidth = Number($('#brushSize').value);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.x, stroke.y);
  ctx.lineTo(p.x + 0.01, p.y);
  ctx.stroke();
  stroke = p;
}
$('#uploadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(canvas.width / bmp.width, canvas.height / bmp.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bmp, (canvas.width - bmp.width * s) / 2, (canvas.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  } catch {
    showError($('#drawDlg'), 'That image couldn’t be opened.');
  }
});
function openDraw() {
  closeTray();
  showError($('#drawDlg'), null);
  $('#drawDlg').showModal();
}
$('#saveSticker').onclick = async () => {
  const dlg = $('#drawDlg');
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let painted = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) { painted = true; break; }
  if (!painted) return showError(dlg, 'Draw something first.');
  const out = document.createElement('canvas');
  out.width = out.height = 200;
  out.getContext('2d').drawImage(canvas, 0, 0, 200, 200);
  try {
    const { sticker } = await api('POST', '/api/my-stickers', { data: out.toDataURL('image/png') });
    S.myStickers.unshift(sticker);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dlg.close();
    startPlacing({ kind: S.doodleStyle === 'magnet' ? 'magnet' : 'image', mine: sticker.id, content: sticker.data });
  } catch (err) {
    showError(dlg, err);
  }
};

// ---------------------------------------------------------------- misc wiring

$('#shareBtn').onclick = async () => {
  const url = `${location.origin}/day/${S.day}`;
  if (navigator.share) {
    try { await navigator.share({ title: `Kindboard · ${fmtDay(S.day)}`, text: 'Kind words from strangers.', url }); return; } catch { /* cancelled */ }
  }
  copy(url, 'Link copied');
};
for (const b of $$('[data-close]')) b.onclick = () => b.closest('dialog').close();
for (const b of $$('[data-open]')) b.onclick = () => { hidePopovers(); $(`#${b.dataset.open}`).showModal(); };
for (const d of $$('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  });
}

// ---------------------------------------------------------------- live updates

function connectStream() {
  S.stream?.close();
  if (!S.me) return;
  let wasOpen = false;
  const es = new EventSource('/api/stream');
  S.stream = es;
  es.onopen = () => {
    if (wasOpen) syncBoard(); // reconnected: catch up on anything missed, without disturbing the view
    wasOpen = true;
  };
  const on = (name, fn) => es.addEventListener(name, (e) => fn(JSON.parse(e.data)));
  on('note', (n) => {
    if (n.day !== S.day) return;
    const fresh = !S.notes.has(n.id);
    const wasPending = S.notes.get(n.id)?.pending;
    if (!n.reactions) n.reactions = S.notes.get(n.id)?.reactions || S.reacts.get(reactKey('note', n.id)) || {};
    const el = upsertNote(n);
    if (fresh) el.classList.add('fresh');
    if (wasPending && !n.pending && n.mine) toast('Your note was approved and is now on the board.', 5000);
    if (S.openNote === n.id) updateThreadLock();
    updateEmpty();
  });
  on('reactions', ({ type, id, counts }) => {
    const key = reactKey(type, id);
    const old = S.reacts.get(key) || {};
    const data = {};
    for (const [e, n] of Object.entries(counts)) data[e] = { n, mine: !!old[e]?.mine };
    setReactions(type, id, data);
  });
  on('reply', (r) => {
    const existing = $(`.reply[data-id="${CSS.escape(r.id)}"]`);
    if (existing) existing.replaceWith(replyEl(r));
    else addReply(r);
  });
  on('sticker', (s) => {
    if (s.day !== S.day) return;
    const fresh = !S.stickers.has(s.id);
    const el = upsertSticker(s);
    if (fresh) el.classList.add('fresh');
  });
  on('removed', ({ type, id, declined }) => {
    removeItem(type, id);
    if (declined) toast(`One of your ${type === 'reply' ? 'replies' : type === 'sticker' ? 'stickers' : 'notes'} wasn\u2019t approved, so it won\u2019t be posted.`, 6000);
  });
  on('cursor', showCursor);
  on('presence', ({ online }) => { for (const el of $$('.presence-n')) el.textContent = online; });
  on('me', (me) => {
    const gotStrike = S.me && me.strikes > S.me.strikes;
    S.me = { ...S.me, ...me };
    renderMe();
    updateThreadLock();
    if (gotStrike) toast(me.banned ? 'Your identity was paused after 2 strikes.' : 'One of your posts was removed after community flags. That’s strike 1 of 2.', 7000);
  });
}

// Midnight: today's board becomes the archive.
async function checkRollover() {
  try {
    const cfg = await api('GET', '/api/config');
    if (cfg.today === S.cfg.today) return;
    const wasToday = S.day === S.cfg.today;
    S.cfg.today = cfg.today;
    if (S.view === 'board' && wasToday) {
      S.archived = true;
      renderDayNav();
      updateTools();
      updateThreadLock();
      for (const n of S.notes.values()) upsertNote(n);
      toast('A new day has begun. This board is now archived.', 8000);
    } else if (S.view === 'calendar') {
      showCalendar();
    }
  } catch { /* offline; try again next minute */ }
}
setInterval(() => {
  for (const n of S.notes.values()) {
    const t = $('time', S.noteEls.get(n.id));
    if (t) t.textContent = timeAgo(n.createdAt);
  }
}, 60_000);

// ---------------------------------------------------------------- boot

(async function boot() {
  try {
    S.cfg = await api('GET', '/api/config');
    world.style.width = `${S.cfg.boardW}px`;
    world.style.height = `${S.cfg.boardH}px`;
    renderSwatches();
    renderPenColors();
    const draft = store.get('kb_draft');
    if (draft) $('#composeText').value = draft;
    const [meRes, quoteRes] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/quote').catch(() => null)]);
    S.me = meRes.me;
    S.quotes = quoteRes?.quotes || [];
    if (S.me) connectStream();
    const g = new URLSearchParams(location.search).get('google');
    if (S.me && g) {
      history.replaceState({}, '', location.pathname);
      if (g === 'new') {
        $('#savedName').textContent = S.me.name;
        $('#savedHandle').textContent = S.me.handle;
        setAvatar($('#savedAvatar'), S.me);
        $('#savedDlg .muted').textContent = 'You signed in with Google, so there\u2019s no password to remember. Just choose Continue with Google next time. We never see your name or email.';
        setTimeout(() => $('#savedDlg').showModal(), 2200);
      } else {
        const msg = { 'welcome-back': `Welcome back, ${S.me.name}`, linked: 'Google sign-in added. You can always get back in with it now.', taken: 'That Google account is already linked to another identity.' }[g];
        if (msg) setTimeout(() => toast(msg, 5000), 2000);
      }
    }
    await route();
    refreshSky();
    if (sky.weather === 'live' && store.get('kb_geo')) fetchLiveWeather();
    setInterval(checkRollover, 60_000);
  } catch (e) {
    toast('Couldn’t reach Kindboard. Check your connection and refresh.', 10000);
    console.error(e);
  }
})();
