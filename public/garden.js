// A small pixel-art scene. On the intro, a little boy (bowl cut, jumpsuit, rosy cheeks)
// walks across a field, sows seeds, waters them, flowers bloom and a bush grows fruit,
// and he gives a fruit to a passer-by while butterflies flit about. On the calendar
// ("visit" mode) he just strolls in, says hi, and walks on.
// It's gently interactive: hover and he looks up at you, pat his head and he smiles and
// little hearts float up; butterflies flutter away from the cursor. Nothing rough, ever.
// Everything is drawn at low resolution and scaled up with crisp pixels; all art is original.

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (t) => 1 - (1 - clamp01(t)) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- sprites
// Palette keys: h hair · s skin · e eyes · c cheeks · m mouth · j jumpsuit · z zip/pocket · b shoes · '.' empty
// Heads, one per hairstyle. Expressions (happy, looking up) are derived from these.
const HEADS = {
  bowl: ['...hhhhhh...', '..hhhhhhhh..', '.hhhhhhhhhh.', '.hhhhhhhhhh.', '.hssssssssh.', '.hsessssesh.', '.hcssssssch.', '..ssssmsss..', '...ssssss...'],
  short: ['....hhhh....', '..hhhhhhhh..', '.hhhhhhhhhh.', '.hhssssshhh.', '.hssssssssh.', '.ssessssess.', '.scsssssscs.', '..ssssmsss..', '...ssssss...'],
  curly: ['..hhhhhhhh..', '.hhhhhhhhhh.', 'hhhhhhhhhhhh', 'hhhhhhhhhhhh', 'hhsssssssshh', 'hhsessssesh.', '.hcssssssch.', '..ssssmsss..', '...ssssss...'],
  long: ['...hhhhhh...', '..hhhhhhhh..', '.hhhhhhhhhh.', '.hhhssssshh.', '.hssssssssh.', '.hsessssesh.', 'hhcsssssschh', 'hhssssmssshh', 'hh.ssssss.hh'],
  bun: ['.....hh.....', '....hhhh....', '..hhhhhhhh..', '.hhhhhhhhhh.', '.hssssssssh.', '.hsessssesh.', '.hcssssssch.', '..ssssmsss..', '...ssssss...'],
};
export const HAIRSTYLES = Object.keys(HEADS);
function headFor(style, face) {
  const rows = (HEADS[style] || HEADS.bowl).map((row) => row.split(''));
  if (face !== 'normal') {
    const eyeRow = rows.findIndex((row) => row.includes('e'));
    const cols = rows[eyeRow].flatMap((k, i) => (k === 'e' ? [i] : []));
    for (const c of cols) {
      rows[eyeRow][c] = 's';
      if (face === 'happy') {
        // closed, smiling eyes: a tiny ^
        rows[eyeRow][c - 1] = 'e';
        rows[eyeRow][c + 1] = 'e';
        rows[eyeRow - 1][c] = 'e';
      } else {
        rows[eyeRow - 1][c] = 'e'; // looking up at you
      }
    }
    if (face === 'happy') {
      const mouthRow = rows.findIndex((row) => row.includes('m'));
      const mc = rows[mouthRow].indexOf('m');
      rows[mouthRow][mc - 1] = 'm';
    }
  }
  return rows.map((row) => row.join(''));
}
const BODY = {
  idle: ['..jjjzjjjj..', '.sjjjzjjjjs.', '.sjjjzjjjjs.', '..jjjjjjjj..', '..jjj..jjj..', '..jjj..jjj..', '.bbbb..bbbb.'],
  walk1: ['..jjjzjjjj..', '.sjjjzjjjj..', '..jjjzjjjjs.', '..jjjjjjjj..', '..jjj..jjj..', '.jjj....jjj.', 'bbbb....bbbb'],
  walk2: ['..jjjzjjjj..', '..jjjzjjjjs.', '.sjjjzjjjj..', '..jjjjjjjj..', '...jjjjjj...', '....jjjj....', '...bbbbbb...'],
  reach: ['..jjjzjjjj..', '..jjjzjjjjss', '.sjjjzjjjj..', '..jjjjjjjj..', '..jjj..jjj..', '..jjj..jjj..', '.bbbb..bbbb.'],
  wave1: ['..jjjzjjjjj.', '.sjjjzjjjj..', '.sjjjzjjjj..', '..jjjjjjjj..', '..jjj..jjj..', '..jjj..jjj..', '.bbbb..bbbb.'],
};
BODY.wave2 = BODY.wave1;
const CROUCH_BODY = ['.jjjzjjjjjss', '.jjjjjjjjj..', 'jjj....jjj..', 'bbb....bbb..'];
// the raised arm for waving, drawn beside the head (two heights = two frames)
const WAVE_ARM = { wave1: [[11, 3, 's'], [11, 4, 's'], [11, 5, 'j'], [11, 6, 'j'], [11, 7, 'j'], [11, 8, 'j']], wave2: [[11, 2, 's'], [11, 3, 's'], [11, 4, 'j'], [11, 5, 'j'], [11, 6, 'j'], [11, 7, 'j'], [11, 8, 'j']] };

function kidRows(frame, face, style = 'bowl') {
  const head = headFor(style, face);
  if (frame === 'crouch') return [...Array(3).fill('............'), ...head, ...CROUCH_BODY];
  const rows = [...head, ...(BODY[frame] || BODY.idle)].map((r) => r.split(''));
  for (const [x, y, k] of WAVE_ARM[frame] || []) rows[y][x] = k;
  return rows.map((r) => r.join(''));
}

const CAN = { up: ['.ww...', 'wwww..', 'wwwwww', 'wwww..'], tip: ['.ww...', 'wwww..', 'wwww..', 'wwwwww'] };
const BUTTERFLY = [['ww.ww', 'wwbww', '.w.w.'], ['.wbw.', '.wbw.', '..b..']];
const HEART = ['r.r', 'rrr', '.r.'];
const CLOUD = ['....cccc......', '..cccccccc.cc.', '.cccccccccccccc', 'cccccccccccccc', '.cccccccccccc.'];
const BUSH = ['...lllll...', '.lLLlllllll.', 'lLllllllllll', 'llllllllllll', 'llllllllllll', '.llllllllll.'];
const GLYPHS = { h: ['x..', 'x..', 'xxx', 'x.x', 'x.x'], i: ['x', '.', 'x', 'x', 'x'], '!': ['x', 'x', 'x', '.', 'x'] };

// Choices for people's own characters (the boy keeps his bowl cut and mint jumpsuit).
export const LOOKS = {
  skin: ['#f6d5b8', '#ecc19c', '#d29a6c', '#a36d47', '#6e452b'],
  hair: ['#3d2a20', '#1f1a1c', '#8a4b2f', '#d9a441', '#c0583c', '#7a7686'],
  suit: [['#5fb7a1', '#8fd3c1'], ['#8f88ee', '#bdb8fb'], ['#f0a27a', '#f7c6a8'], ['#e7a7bb', '#f4ccd8'], ['#6a9fd8', '#a3c6ee'], ['#e9c46a', '#f3dc9c'], ['#7ca666', '#a9cd94'], ['#55556a', '#80809a']],
};
export function lookPalette(look) {
  const l = look || {};
  const suit = LOOKS.suit[l.suit] || LOOKS.suit[2];
  return { style: HAIRSTYLES.includes(l.style) ? l.style : 'short', pal: { s: LOOKS.skin[l.skin] ?? LOOKS.skin[1], h: LOOKS.hair[l.hair] ?? LOOKS.hair[2], j: suit[0], z: suit[1] } };
}
export function randomLook() {
  const pick = (n) => Math.floor(Math.random() * n);
  return { style: HAIRSTYLES[pick(HAIRSTYLES.length)], skin: pick(LOOKS.skin.length), hair: pick(LOOKS.hair.length), suit: 1 + pick(LOOKS.suit.length - 1) };
}

/** Draw one character, standing or waving, onto a small canvas (for previews). */
export function drawCharacter(canvas, look, frame = 'idle', face = 'normal') {
  const ctx = canvas.getContext('2d');
  const { style, pal } = lookPalette(look);
  const css = getComputedStyle(document.documentElement);
  const base = { e: css.getPropertyValue('--px-eye').trim() || '#2b2228', c: css.getPropertyValue('--px-cheek').trim() || '#ef5a5a', m: css.getPropertyValue('--px-mouth').trim() || '#c2475a', b: css.getPropertyValue('--px-shoe').trim() || '#5b3b2a' };
  const rows = kidRows(frame, face, style);
  canvas.width = 14;
  canvas.height = 18;
  ctx.clearRect(0, 0, 14, 18);
  rows.forEach((row, j) => [...row].forEach((k, i) => {
    if (k === '.') return;
    ctx.fillStyle = pal[k] ?? base[k] ?? base.e;
    ctx.fillRect(i + 1, j + 1, 1, 1);
  }));
}

// ---------------------------------------------------------------- sky & weather
// Sky gradient (top, horizon) through the day, by local hour. Interpolated between stops.
const SKY = [
  [0, '#0b1026', '#1c2a52'], [4.8, '#141c40', '#2e3566'], [5.8, '#3a4482', '#b98aa6'], [6.6, '#6f8fcb', '#f4b896'],
  [8, '#8cc0ea', '#f5e2c6'], [12, '#84bfec', '#d7edf9'], [16.5, '#8ab7e2', '#f3dcb6'], [18, '#6c6db3', '#f2a07c'],
  [19, '#3b3c7e', '#c4718a'], [20.2, '#1b2150', '#4a3f74'], [21.5, '#0e1430', '#22305e'], [24, '#0b1026', '#1c2a52'],
];
const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'storm'];
export { WEATHERS };
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgbHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mixHex = (a, b, t) => { const A = hexRgb(a); const B = hexRgb(b); return rgbHex(A.map((v, i) => v + (B[i] - v) * t)); };
function skyAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (SKY[i + 1][0] < h) i++;
  const [h0, t0, b0] = SKY[i];
  const [h1, t1, b1] = SKY[i + 1];
  const k = (h - h0) / (h1 - h0);
  return [mixHex(t0, t1, k), mixHex(b0, b1, k)];
}
// 0 = full daylight, 1 = deep night
function nightness(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h <= 17.5) return 0;
  if (h > 17.5 && h < 20.5) return (h - 17.5) / 3;
  if (h > 4.5 && h < 7) return 1 - (h - 4.5) / 2.5;
  return 1;
}
/** Words for the little caption: he shows up whatever the weather. */
export function skyCaption(hour, weather) {
  const n = nightness(hour);
  const h = ((hour % 24) + 24) % 24;
  if (weather === 'storm') return 'Stormy out there. He\u2019s still tending the garden.';
  if (weather === 'rain') return 'Rainy where you are. He came anyway.';
  if (weather === 'snow') return 'Snowing where you are. The flowers are tougher than they look.';
  if (n > 0.7) return 'It\u2019s late. He\u2019s still here.';
  if (h >= 4.5 && h < 7.5) return 'Early light. He\u2019s already up.';
  if (h >= 17 && h < 20.5) return 'Golden hour. One more watering before dark.';
  if (weather === 'cloudy') return 'A grey sky. The garden doesn\u2019t mind.';
  return '';
}
const STAR = ['.s.', 'sss', '.s.'];
const MOON = ['..mmm..', '.mmm...', 'mmm....', 'mmm....', 'mmm....', '.mmm...', '..mmm..'];
const SUN = ['..sss..', '.sssss.', 'sssssss', 'sssssss', 'sssssss', '.sssss.', '..sss..'];
const UMBRELLA = ['....uu....', '..uuuuuu..', '.uuuuuuuu.', 'uuuuuuuuuu', 'u..u..u..u', '....k.....', '....k.....', '....k.....', '....k.....', '....k.....'];

/** A head-and-shoulders portrait of someone's character, as a tiny image (for avatars). */
const portraitCache = new Map();
export function characterPortrait(look) {
  const key = JSON.stringify(look);
  if (portraitCache.has(key)) return portraitCache.get(key);
  const { style, pal } = lookPalette(look);
  const css = getComputedStyle(document.documentElement);
  const base = { e: css.getPropertyValue('--px-eye').trim() || '#2b2228', c: css.getPropertyValue('--px-cheek').trim() || '#ef5a5a', m: css.getPropertyValue('--px-mouth').trim() || '#c2475a', b: '#5b3b2a' };
  const rows = kidRows('idle', 'normal', style).slice(0, 13); // head + shoulders
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  rows.forEach((row, j) => [...row].forEach((k, i) => {
    if (k === '.') return;
    ctx.fillStyle = pal[k] ?? base[k] ?? base.e;
    ctx.fillRect(i + 2, j + 3, 1, 1);
  }));
  const url = canvas.toDataURL('image/png');
  portraitCache.set(key, url);
  return url;
}

function cssColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    hill: v('--garden-hill-2', '#d5e0c3'), hill2: v('--garden-hill', '#e2e9d3'),
    grass: v('--px-grass', '#7fb069'), grassDark: v('--px-grass-dark', '#5e8f4e'), dirt: v('--px-dirt', '#c79a6b'),
    dirtDark: v('--px-dirt-dark', '#a87d52'), c: v('--px-cloud', '#ffffff'),
    h: v('--px-hair', '#3d2a20'), s: v('--garden-skin', '#f0c9a6'), e: v('--px-eye', '#2b2228'), cheek: v('--px-cheek', '#ef5a5a'),
    m: v('--px-mouth', '#c2475a'), j: v('--px-suit', '#5fb7a1'), z: v('--px-suit-light', '#8fd3c1'), b: v('--px-shoe', '#5b3b2a'),
    w: v('--garden-can', '#7ea6c8'), water: v('--garden-water', '#86bde3'), stem: v('--garden-stem', '#6c9659'),
    l: v('--garden-bush', '#7ca666'), L: v('--px-bush-light', '#9cc584'), fruit: v('--garden-fruit', '#df7f4b'), flowerEye: v('--px-flower-eye', '#f2c94c'),
    petals: [v('--garden-petal-1', '#e7a7bb'), v('--garden-petal-2', '#b7aef0'), v('--garden-petal-3', '#ecc964'), v('--garden-petal-4', '#f0a983')],
    friendSuit: v('--px-friend-suit', '#f0a27a'), friendZip: v('--px-friend-zip', '#f7c6a8'), friendHair: v('--px-friend-hair', '#8a4b2f'),
    bubble: v('--raised', '#ffffff'), bubbleInk: v('--ink', '#161513'), heart: v('--px-heart', '#ef5a7a'),
    r: '#d9473f', snow: '#f4f7fb', umbrella: '#e9c46a', umbrella2: '#8f88ee',
    wings: [v('--px-wing-1', '#f2b8c6'), v('--px-wing-2', '#f6d77a'), v('--px-wing-3', '#b9b2f2'), v('--px-wing-4', '#9fd3c7')],
  };
}

export function startGarden(canvas, { mode = 'garden', look = null } = {}) {
  let friendLook = look; // the viewer's own character, when they have one
  const visit = mode === 'visit';
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let PX = 4; // screen pixels per art pixel
  let W = 0;
  let H = 0;
  let colors = cssColors();
  let plots = [];
  let tufts = [];
  let pebbles = [];
  let clouds = [];
  let butterflies = [];
  let hearts = [];
  let stars = [];
  let fireflies = [];
  let rain = [];
  let shooting = null;
  let nextShoot = 4000;
  let flash = 0;
  let nextFlash = 5000;
  let bolt = null;
  let env = { hour: new Date().getHours() + new Date().getMinutes() / 60, weather: 'clear' };
  let night = 0;
  let skyCache = null;
  let onSky = null;
  let raf = 0;
  let running = false;
  let last = 0;
  let clock = 0;

  const groundY = () => Math.round(H * (visit ? 0.74 : 0.9));
  const wet = () => env.weather === 'rain' || env.weather === 'storm';
  const kid = { x: -14, facing: 1, frame: 'idle', walkT: 0, can: true, tilt: false, holding: false, happyUntil: 0, lookUntil: 0 };
  let friend = null;
  let drops = [];
  let flying = null;
  let plan = [];
  let step = 0;
  let stepStart = 0;
  let fade = 1;

  function px(x, y, w = 1, h = 1) { ctx.fillRect(Math.round(x), Math.round(y), w, h); }
  function sprite(rows, x, y, pal = {}, flip = false) {
    const w = rows[0].length;
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < w; i++) {
        const k = rows[j][i];
        if (k === '.') continue;
        ctx.fillStyle = pal[k] ?? colors[k] ?? colors.e;
        px(x + (flip ? w - 1 - i : i), y + j);
      }
    }
  }

  function layout() {
    const r = canvas.getBoundingClientRect();
    PX = r.width < 600 ? 3 : 4;
    W = Math.max(60, Math.ceil(r.width / PX));
    H = Math.max(30, Math.ceil(r.height / PX));
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;
    const gy = groundY();
    tufts = [];
    for (let x = 2; x < W; x += 5 + Math.floor(Math.random() * 6)) tufts.push({ x, tall: Math.random() < 0.4 });
    pebbles = [];
    for (let i = 0; i < W * (H - gy) * 0.012; i++) pebbles.push({ x: Math.floor(Math.random() * W), y: gy + 3 + Math.floor(Math.random() * Math.max(1, H - gy - 3)) });
    stars = Array.from({ length: Math.floor((W * gy) / 260) }, () => ({ x: Math.floor(Math.random() * W), y: Math.floor(Math.random() * gy * 0.8), big: Math.random() < 0.12, seed: Math.random() * TAU }));
    applyEnv();
    reset();
  }

  // Everything that depends on time and weather.
  function applyEnv() {
    night = nightness(env.hour);
    const gy = groundY();
    const cloudCount = { clear: 2, cloudy: 5, rain: 6, storm: 7, snow: 4 }[env.weather] ?? 2;
    const nClouds = Math.max(2, Math.round((W / 160) * cloudCount));
    clouds = Array.from({ length: nClouds }, (_, i) => ({
      x: (W / nClouds) * i + Math.random() * 30, y: 2 + Math.floor(Math.random() * Math.max(1, (visit ? gy * 0.3 : gy * 0.35))),
      speed: (env.weather === 'storm' ? 0.004 : 0.0012) + Math.random() * 0.001,
    }));
    const fall = env.weather === 'storm' ? 0.1 : env.weather === 'rain' ? 0.055 : env.weather === 'snow' ? 0.045 : 0;
    rain = Array.from({ length: Math.round(W * (visit ? H / 40 : H / 50) * fall * 3) }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.6 + Math.random() * 0.4, seed: Math.random() * TAU }));
    fireflies = night > 0.55 && (env.weather === 'clear' || env.weather === 'cloudy')
      ? Array.from({ length: visit ? 5 : 9 }, () => ({ x: Math.random() * W, y: gy - 3 - Math.random() * 20, seed: Math.random() * TAU, vx: (Math.random() - 0.5) * 0.004 }))
      : [];
    // the sky itself: a banded, lightly dithered gradient, drawn once per change
    if (!visit) {
      let [top, bottom] = skyAt(env.hour);
      const grey = { cloudy: ['#8d96a3', 0.35], rain: ['#7d8794', 0.5], storm: ['#3a404e', 0.65], snow: ['#c4ccd6', 0.4] }[env.weather];
      if (grey) { top = mixHex(top, grey[0], grey[1] * (1 - night * 0.5)); bottom = mixHex(bottom, grey[0], grey[1] * (1 - night * 0.5)); }
      skyCache = document.createElement('canvas');
      skyCache.width = W;
      skyCache.height = gy;
      const sc = skyCache.getContext('2d');
      const BANDS = 14;
      const bayer = [0, 2, 3, 1];
      for (let y = 0; y < gy; y++) {
        for (let x = 0; x < W; x += 1) {
          const f = clamp01(y / gy + (bayer[(x % 2) + (y % 2) * 2] - 1.5) / (BANDS * 2));
          sc.fillStyle = mixHex(top, bottom, Math.floor(f * BANDS) / BANDS);
          sc.fillRect(x, y, 1, 1);
        }
      }
      onSky?.({ top, bottom, dark: night > 0.5 || env.weather === 'storm', caption: skyCaption(env.hour, env.weather) });
    } else {
      skyCache = null;
    }
    // butterflies are for fair daylight; nights get fireflies
    const flutter = night < 0.4 && (env.weather === 'clear' || env.weather === 'cloudy');
    if (!flutter) butterflies = [];
    else if (!butterflies.length) makeButterflies(visit ? 2 : env.weather === 'cloudy' ? 2 : 3);
  }

  function makeButterflies(n) {
    butterflies = Array.from({ length: n }, (_, i) => ({
      x: Math.random() * W, y: groundY() - 14 - Math.random() * 18, vx: (Math.random() < 0.5 ? -1 : 1) * (0.006 + Math.random() * 0.006), vy: 0,
      seed: Math.random() * TAU, color: colors.wings[i % colors.wings.length],
    }));
  }

  function reset() {
    Object.assign(kid, { x: -14, facing: 1, frame: 'idle', walkT: 0, can: !visit, tilt: false, holding: false, happyUntil: 0, lookUntil: 0 });
    friend = null;
    drops = [];
    hearts = [];
    flying = null;
    step = 0;
    stepStart = clock;
    fade = visit ? 1 : 0;
    if (visit) {
      plots = [0.12, 0.3, 0.7, 0.88].map((f, i) => ({ x: Math.round(W * f), kind: i === 2 ? 'fruit' : 'flower', petal: colors.petals[i % 4], sown: true, seedAt: 0, wateredAt: -1e6, height: 7 + (i % 3) * 2, fruits: 3 }));
      const meet = Math.round(W * (0.42 + Math.random() * 0.12));
      plan = [{ kind: 'walk', to: meet, meet: friendLook ? meet + 18 : null }, { kind: 'hi', dur: 3000 }, { kind: 'walk', to: W + 16 }, { kind: 'rest', dur: 26000 + Math.random() * 14000 }];
      if (friendLook) { friend = newFriend(); friend.target = meet + 18; }
      if (night < 0.4 && !wet() && env.weather !== 'snow') makeButterflies(2);
      return;
    }
    const n = Math.max(3, Math.min(7, Math.floor((W * PX) / 190)));
    const start = W * 0.08;
    const span = W * 0.84;
    plots = Array.from({ length: n }, (_, i) => ({
      x: Math.round(start + (span / (n - 1)) * i), kind: i % 3 === 1 ? 'fruit' : 'flower', petal: colors.petals[i % 4],
      sown: false, seedAt: 0, wateredAt: 0, height: 7 + Math.floor(Math.random() * 6), fruits: 3,
    }));
    plan = [];
    for (const [i, p] of plots.entries()) plan.push({ kind: 'walk', to: p.x - 9 }, { kind: 'sow', plot: i, dur: 1500 }, { kind: 'water', plot: i, dur: 1900 });
    const fruitPlot = plots.findLastIndex((p) => p.kind === 'fruit');
    plan.push({ kind: 'wait', dur: 2600 });
    if (fruitPlot >= 0) plan.push({ kind: 'walk', to: plots[fruitPlot].x - 11 }, { kind: 'pick', plot: fruitPlot, dur: 1100 });
    plan.push({ kind: 'greet', dur: 0 }, { kind: 'give', dur: 1500 }, { kind: 'wave', dur: 2600 }, { kind: 'rest', dur: 5000 }, { kind: 'fadeout', dur: 1400 });
    if (night < 0.4 && !wet() && env.weather !== 'snow') makeButterflies(3);
  }

  function nextStep() {
    step++;
    stepStart = clock;
    if (step >= plan.length) reset();
  }

  function newFriend() {
    const { style, pal } = lookPalette(friendLook || randomLook());
    return { x: W + 14, facing: -1, walkT: 0, frame: 'walk1', holding: false, leaving: false, wave: false, happyUntil: 0, lookUntil: 0, style, pal };
  }
  const walkFrame = (p) => (Math.floor(p.walkT / 160) % 2 ? 'walk1' : 'walk2');

  // ---- story
  function update(dt) {
    clock += dt;
    if (!visit) fade = Math.min(1, fade + dt / 900);
    const k = kid;
    // being patted: he stops for a moment to enjoy it, and the story waits for him
    const patted = clock < k.happyUntil;
    if (patted) {
      stepStart += dt;
      k.frame = 'idle';
    } else {
      const s = plan[step];
      const t = clock - stepStart;
      k.frame = 'idle';
      k.tilt = false;
      if (s.kind === 'walk') {
        const dir = Math.sign(s.to - k.x) || 1;
        k.facing = dir;
        k.x += dir * dt * 0.012;
        k.walkT += dt;
        k.frame = walkFrame(k);
        if ((dir > 0 && k.x >= s.to) || (dir < 0 && k.x <= s.to)) { k.x = s.to; nextStep(); }
      }
      if (s.kind === 'sow') {
        k.frame = t > s.dur * 0.15 && t < s.dur * 0.85 ? 'crouch' : 'idle';
        const p = plots[s.plot];
        if (t > s.dur * 0.45 && !p.sown) { p.sown = true; p.seedAt = clock; }
        if (t >= s.dur) nextStep();
      }
      if (s.kind === 'water' && wet()) {
        // the rain is already watering it: he just looks up and smiles
        k.lookUntil = clock + 400;
        if (t >= 900) { plots[s.plot].wateredAt = clock; nextStep(); }
      } else if (s.kind === 'water') {
        k.frame = 'reach';
        const pour = t > s.dur * 0.15 && t < s.dur * 0.85;
        k.tilt = pour;
        if (pour && Math.random() < dt / 70) {
          const sp = spout();
          drops.push({ x: sp.x, y: sp.y, vy: 0.01 });
        }
        if (t >= s.dur) { plots[s.plot].wateredAt = clock; nextStep(); }
      }
      if (s.kind === 'wait' && t >= s.dur) nextStep();
      if (s.kind === 'pick') {
        k.can = false;
        k.frame = 'reach';
        if (t > s.dur * 0.5 && !k.holding) { k.holding = true; plots[s.plot].fruits--; }
        if (t >= s.dur) nextStep();
      }
      if (s.kind === 'greet') {
        if (!friend) friend = newFriend();
        k.facing = 1;
        k.frame = k.holding ? 'reach' : 'idle';
        friend.x -= dt * 0.012;
        friend.walkT += dt;
        friend.frame = walkFrame(friend);
        if (friend.x <= k.x + 16) { friend.x = k.x + 16; friend.frame = 'idle'; nextStep(); }
      }
      if (s.kind === 'give') {
        k.frame = 'reach';
        friend.frame = 'reach';
        if (!flying && t > s.dur * 0.25) { flying = { t: 0 }; k.holding = false; }
        if (flying) flying.t = clamp01((t / s.dur - 0.25) / 0.5);
        if (t >= s.dur) { flying = null; friend.holding = true; friend.frame = 'idle'; friend.happyUntil = clock + 1400; nextStep(); }
      }
      if (s.kind === 'wave' || s.kind === 'hi') {
        k.frame = Math.floor(clock / 260) % 2 ? 'wave1' : 'wave2';
        if (friend && s.kind === 'wave') friend.wave = true;
        if (t >= s.dur) {
          if (friend) { friend.leaving = true; friend.wave = false; }
          nextStep();
        }
      }
      if (s.kind === 'rest' && t >= s.dur) nextStep();
      if (s.kind === 'fadeout') {
        fade = 1 - clamp01(t / s.dur);
        if (t >= s.dur) nextStep();
      }
    }
    if (visit && friend) {
      const s = plan[step];
      if (s.kind === 'walk' && s.meet != null && friend.x > friend.target && clock >= friend.happyUntil) {
        friend.x = Math.max(friend.target, friend.x - dt * 0.012);
        friend.walkT += dt;
        friend.frame = walkFrame(friend);
      } else if (s.kind === 'hi') {
        friend.facing = -1;
        friend.wave = true;
      } else if (s.kind !== 'walk' || s.meet == null) {
        friend.wave = false;
        friend.leaving = true;
      }
    }
    if (friend) {
      if (friend.wave) friend.frame = Math.floor(clock / 260) % 2 ? 'wave2' : 'wave1';
      if (friend.leaving && clock >= friend.happyUntil) {
        friend.facing = 1;
        friend.wave = false;
        friend.x += dt * 0.012;
        friend.walkT += dt;
        friend.frame = walkFrame(friend);
      }
    }
    for (const d of drops) { d.vy += dt * 0.00035; d.y += d.vy * dt; }
    drops = drops.filter((d) => d.y < groundY());
    for (const h of hearts) { h.life += dt; h.y -= dt * 0.006; h.x += Math.sin((h.life + h.seed) / 180) * 0.05; }
    hearts = hearts.filter((h) => h.life < 1600);
    for (const c of clouds) { c.x += c.speed * dt; if (c.x > W + 4) c.x = -16; }
    const gy = groundY();
    for (const d of rain) {
      if (env.weather === 'snow') { d.y += d.v * dt * 0.012; d.x += Math.sin(clock / 700 + d.seed) * 0.02; }
      else { d.y += d.v * dt * (env.weather === 'storm' ? 0.16 : 0.12); d.x -= d.v * dt * 0.03; }
      if (d.y > gy || d.x < -2) { d.y = -Math.random() * 20; d.x = Math.random() * (W + 30); }
    }
    for (const f of fireflies) {
      f.x += f.vx * dt + Math.sin(clock / 900 + f.seed) * 0.01;
      f.y += Math.cos(clock / 1100 + f.seed) * 0.008;
      if (f.x < 0 || f.x > W) f.vx *= -1;
    }
    if (!visit && night > 0.6 && (env.weather === 'clear' || env.weather === 'cloudy')) {
      nextShoot -= dt;
      if (nextShoot <= 0 && !shooting) { shooting = { x: W * (0.2 + Math.random() * 0.7), y: 3 + Math.random() * gy * 0.25, t: 0 }; nextShoot = 6000 + Math.random() * 9000; }
    }
    if (shooting) { shooting.t += dt; if (shooting.t > 900) shooting = null; }
    if (env.weather === 'storm') {
      nextFlash -= dt;
      if (nextFlash <= 0) {
        flash = 1;
        nextFlash = 4000 + Math.random() * 6000;
        let bx = W * (0.15 + Math.random() * 0.7);
        bolt = [];
        for (let y = 0; y < gy * 0.75; y += 3) { bx += Math.round((Math.random() - 0.5) * 6); bolt.push([bx, y]); }
      }
      flash = Math.max(0, flash - dt / 380);
      if (flash <= 0) bolt = null;
    }
    for (const b of butterflies) {
      b.x += b.vx * dt;
      b.y += b.vy * dt + Math.sin(clock / 380 + b.seed) * 0.04 * (dt / 16);
      b.vy *= 0.96;
      b.vx = Math.sign(b.vx) * Math.max(0.006, Math.abs(b.vx) * 0.995);
      const gy = groundY();
      b.y = Math.max(3, Math.min(gy - 6, b.y));
      if (b.x < -6 || b.x > W + 6) { b.vx *= -1; b.y = gy - 12 - Math.random() * 16; }
      if (Math.random() < dt / 4000) b.vx *= -1;
    }
  }

  const topOf = () => groundY() - 16;
  function spout() {
    return { x: kid.facing > 0 ? kid.x + 17 : kid.x - 6, y: topOf() + (kid.tilt ? 11 : 9) };
  }
  function handAt(p) {
    return { x: p.facing > 0 ? p.x + 12 : p.x - 1, y: topOf() + 10 };
  }

  function drawSnowCap(x, y, w) {
    if (env.weather !== 'snow') return;
    ctx.fillStyle = colors.snow;
    px(x, y, w, 1);
  }

  // ---- drawing
  function drawPerson(p, pal) {
    const top = topOf();
    const face = clock < p.happyUntil ? 'happy' : clock < p.lookUntil ? 'up' : 'normal';
    // rosy cheeks, a little brighter when he's happy
    const cheeks = { c: face === 'happy' ? colors.heart : colors.cheek, ...pal };
    sprite(kidRows(p.frame, face, p.style || 'bowl'), Math.round(p.x), top, cheeks, p.facing < 0);
    if (env.weather === 'snow') {
      ctx.fillStyle = colors.r;
      px(p.x + 3, top + 9, 6, 1);
      px(p.x + (p.facing > 0 ? 3 : 7), top + 10, 2, 2);
    }
    if (wet() && p.frame !== 'crouch') {
      const ux = p.facing > 0 ? p.x - 1 : p.x + 3;
      sprite(UMBRELLA, Math.round(ux), top - 9, { u: p === kid ? colors.umbrella : colors.umbrella2, k: colors.e });
    }
    if (p === kid && kid.can && p.frame !== 'crouch' && !p.frame.startsWith('wave')) {
      const hx = p.facing > 0 ? p.x + 11 : p.x - 5;
      sprite(kid.tilt ? CAN.tip : CAN.up, Math.round(hx), top + 9, {}, p.facing < 0);
    }
    if (p.holding) {
      const hand = handAt(p);
      ctx.fillStyle = colors.fruit;
      px(hand.x, hand.y - 2, 2, 2);
    }
  }

  function drawPlant(p) {
    const gy = groundY();
    if (p.sown) {
      ctx.fillStyle = colors.dirtDark;
      px(p.x - 3, gy - 1, 7, 1);
      px(p.x - 2, gy - 2, 5, 1);
    }
    if (p.sown && !p.wateredAt) {
      ctx.fillStyle = colors.h;
      px(p.x, lerp(gy - 8, gy - 3, clamp01((clock - p.seedAt) / 320)));
    }
    if (!p.wateredAt) return;
    const grow = ease((clock - p.wateredAt) / 5200);
    if (p.kind === 'fruit') {
      if (grow < 0.2) { ctx.fillStyle = colors.stem; px(p.x, gy - 3); return; }
      const rows = BUSH.slice(Math.max(0, BUSH.length - Math.ceil(BUSH.length * grow)));
      sprite(rows, p.x - 6, gy - 2 - rows.length);
      drawSnowCap(p.x - 3, gy - 3 - rows.length, 7);
      if (grow > 0.85) {
        ctx.fillStyle = colors.fruit;
        const spots = [[-3, -5], [2, -6], [0, -3]];
        for (let i = 0; i < p.fruits; i++) px(p.x + spots[i][0], gy + spots[i][1], 2, 2);
      }
      return;
    }
    const h = Math.max(1, Math.round(p.height * grow));
    const sway = grow > 0.9 && Math.floor(clock / (env.weather === 'storm' ? 260 : 700) + p.x) % 2 ? 1 : 0;
    ctx.fillStyle = colors.stem;
    px(p.x, gy - 2 - h, 1, h);
    if (h > 3) { ctx.fillStyle = colors.l; px(p.x + 1, gy - 2 - Math.floor(h * 0.45), 2, 1); px(p.x - 2, gy - 2 - Math.floor(h * 0.7), 2, 1); }
    if (grow > 0.75) {
      const fx = p.x + sway;
      const fy = gy - 3 - h;
      ctx.fillStyle = p.petal;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, -2], [0, 2]]) px(fx + dx, fy + dy);
      ctx.fillStyle = colors.flowerEye;
      px(fx, fy);
      drawSnowCap(fx - 1, fy - 3, 3);
    }
  }

  function drawBubble(p, alpha) {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const x = Math.round(p.x) + 11;
    const y = topOf() - 10;
    const w = 15;
    ctx.fillStyle = colors.bubbleInk;
    px(x, y, w, 9);
    ctx.fillStyle = colors.bubble;
    px(x + 1, y + 1, w - 2, 7);
    ctx.fillStyle = colors.bubbleInk;
    px(x + 1, y + 9, 2, 1);
    px(x, y + 10, 1, 1);
    let gx = x + 3;
    for (const ch of 'hi!') {
      const gl = GLYPHS[ch];
      for (let j = 0; j < gl.length; j++) for (let i = 0; i < gl[j].length; i++) if (gl[j][i] === 'x') px(gx + i, y + 2 + j);
      gx += gl[0].length + 1;
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    const c = colors;
    const gy = groundY();
    ctx.clearRect(0, 0, W, H);
    if (skyCache) ctx.drawImage(skyCache, 0, 0);
    const clearish = env.weather === 'clear' || env.weather === 'cloudy';
    if (!visit && night > 0.25 && clearish) {
      for (const st of stars) {
        const tw = 0.5 + 0.5 * Math.sin(clock / 600 + st.seed * 5);
        ctx.globalAlpha = (night - 0.2) * (0.35 + tw * 0.65);
        ctx.fillStyle = '#fff8e6';
        if (st.big && tw > 0.6) sprite(STAR, st.x - 1, st.y - 1, { s: '#fff8e6' });
        else px(st.x, st.y);
      }
      ctx.globalAlpha = 1;
    }
    if (!visit) {
      // sun by day along an arc; the moon at night
      const h = ((env.hour % 24) + 24) % 24;
      const dayT = (h - 6) / 13;
      if (night < 0.8 && dayT > 0 && dayT < 1 && env.weather !== 'storm') {
        ctx.globalAlpha = (1 - night) * (env.weather === 'clear' ? 1 : 0.45);
        sprite(SUN, Math.round(W * (0.1 + dayT * 0.8)), Math.round(gy * 0.62 - Math.sin(dayT * Math.PI) * gy * 0.5), { s: h < 8 || h > 16.5 ? '#f7b267' : '#f9d56e' });
        ctx.globalAlpha = 1;
      }
      if (night > 0.4) {
        ctx.globalAlpha = night * (env.weather === 'clear' ? 1 : 0.5);
        sprite(MOON, Math.round(W * 0.78), Math.round(gy * 0.14), { m: '#f4ecd2' });
        ctx.globalAlpha = 1;
      }
      if (shooting) {
        const k = shooting.t / 900;
        for (let i = 0; i < 8; i++) {
          ctx.globalAlpha = (1 - k) * (1 - i / 8);
          ctx.fillStyle = '#fff8e6';
          px(shooting.x + k * 40 - i, shooting.y + k * 14 - i * 0.35);
        }
        ctx.globalAlpha = 1;
      }
    }
    // blocky far hills and slow clouds (dimmed toward night blue as it gets late)
    const dim = (hex, k = 0.62) => (hex.startsWith('#') ? mixHex(hex, '#141a3a', night * k) : hex);
    ctx.fillStyle = dim(c.hill);
    for (let x = 0; x < W; x += 2) {
      const hgt = Math.round(10 + Math.sin(x * 0.03 + 1) * 6 + Math.sin(x * 0.011) * 5);
      px(x, gy - hgt, 2, hgt);
    }
    ctx.fillStyle = dim(c.hill2);
    for (let x = 0; x < W; x += 2) {
      const hgt = Math.round(5 + Math.sin(x * 0.05 + 3) * 3);
      px(x, gy - hgt, 2, hgt);
    }
    const cloudColor = env.weather === 'storm' ? '#5a6070' : wet() ? '#9aa3ae' : night > 0.5 ? '#39416a' : c.c;
    ctx.globalAlpha = 0.85;
    for (const cl of clouds) sprite(CLOUD, Math.round(cl.x), cl.y, { c: cloudColor });
    ctx.globalAlpha = 1;
    // ground: a grass edge, then soil with pebbles
    ctx.fillStyle = dim(c.dirt, 0.55);
    px(0, gy, W, H - gy);
    ctx.fillStyle = dim(c.dirtDark, 0.55);
    for (const pb of pebbles) px(pb.x, pb.y, 2, 1);
    ctx.fillStyle = dim(c.grass, 0.5);
    px(0, gy, W, 2);
    ctx.fillStyle = dim(c.grassDark, 0.5);
    for (let x = 0; x < W; x += 4) px(x + ((x / 4) % 2), gy + 2, 2, 1);
    if (env.weather === 'snow') { ctx.fillStyle = c.snow; px(0, gy, W, 2); }
    const sway = Math.floor(clock / (env.weather === 'storm' ? 250 : 650)) % 2;
    ctx.fillStyle = env.weather === 'snow' ? c.snow : dim(c.grassDark, 0.5);
    for (const tf of tufts) {
      px(tf.x, gy - 1);
      px(tf.x + 2, gy - 1);
      px(tf.x + 1 + (tf.tall ? sway : 0), gy - (tf.tall ? 3 : 2), 1, tf.tall ? 2 : 1);
    }
    ctx.globalAlpha = fade;
    for (const p of plots) drawPlant(p);
    ctx.fillStyle = c.water;
    for (const d of drops) px(d.x, d.y, 1, 2);
    const s = plan[step];
    if (s?.kind === 'hi') {
      const t = clock - stepStart;
      drawBubble(kid, clamp01(t / 250) * (1 - clamp01((t - s.dur + 250) / 250)));
    }
    drawPerson(kid, {});
    if (friend && friend.x < W + 14) {
      drawPerson(friend, friend.pal);
      if (flying) {
        const a = handAt(kid);
        const b = handAt(friend);
        const k = ease(flying.t);
        ctx.fillStyle = c.fruit;
        px(lerp(a.x, b.x, k), lerp(a.y, b.y, k) - 2 - Math.sin(k * Math.PI) * 8, 2, 2);
      }
    }
    for (const b of butterflies) sprite(BUTTERFLY[Math.floor(clock / 140 + b.seed * 3) % 2], Math.round(b.x), Math.round(b.y), { w: b.color, b: c.e });
    // night: the world dims, but he carries a little light, and fireflies come out
    if (night > 0.05) {
      // a soft dusk over the garden itself, fading in from the hills down (no hard edge)
      const veil = ctx.createLinearGradient(0, gy - 26, 0, gy + 4);
      veil.addColorStop(0, 'rgba(11, 18, 48, 0)');
      veil.addColorStop(1, `rgba(11, 18, 48, ${night * 0.28})`);
      ctx.fillStyle = veil;
      ctx.fillRect(0, gy - 26, W, H - gy + 26);
      for (const p of [kid, friend]) {
        if (!p || p.x < -12 || p.x > W + 12) continue;
        const glow = ctx.createRadialGradient(p.x + 6, topOf() + 9, 1, p.x + 6, topOf() + 9, 18);
        glow.addColorStop(0, `rgba(255, 226, 150, ${0.35 * night})`);
        glow.addColorStop(1, 'rgba(255, 226, 150, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(p.x - 14, topOf() - 12, 40, 40);
      }
      for (const f of fireflies) {
        const on = 0.5 + 0.5 * Math.sin(clock / 420 + f.seed * 7);
        ctx.globalAlpha = on * night;
        ctx.fillStyle = 'rgba(240, 236, 140, 0.35)';
        px(f.x - 1, f.y - 1, 3, 3);
        ctx.fillStyle = '#f5f08a';
        px(f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }
    // weather over everything
    if (rain.length) {
      if (env.weather === 'snow') {
        ctx.fillStyle = c.snow;
        for (const d of rain) px(d.x, d.y);
      } else {
        ctx.fillStyle = env.weather === 'storm' ? '#c9d6e6' : c.water;
        ctx.globalAlpha = 0.75;
        for (const d of rain) { px(d.x, d.y); px(d.x - 1, d.y + 1); px(d.x - 1, d.y + 2); }
        ctx.globalAlpha = 1;
      }
    }
    if (flash > 0) {
      if (bolt && !visit) {
        ctx.fillStyle = '#fffbe0';
        for (const [x, y] of bolt) px(x, y, 1, 3);
      }
      ctx.globalAlpha = flash * 0.35;
      ctx.fillStyle = '#ffffff';
      px(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    for (const h of hearts) {
      ctx.globalAlpha = fade * (1 - clamp01((h.life - 900) / 700));
      sprite(HEART, Math.round(h.x), Math.round(h.y), { r: c.heart });
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(50, now - (last || now));
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function staticScene() {
    for (const p of plots) { p.sown = true; p.wateredAt = -1e6; }
    kid.x = Math.round(W * 0.42);
    kid.can = false;
    kid.frame = visit ? 'wave1' : 'idle';
    friend = visit && !friendLook ? null : { ...newFriend(), x: kid.x + 16, frame: visit ? 'wave1' : 'idle', holding: !visit };
    plan = [{ kind: 'rest', dur: Infinity }];
    step = 0;
    fade = 1;
    draw();
  }

  // ---- gentle interaction: screen point → art pixel, then "who's here?"
  function toArt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }
  function personAt(a) {
    const top = topOf();
    for (const p of [kid, friend]) {
      if (!p || p.x < -12 || p.x > W) continue;
      if (a.x >= p.x - 1 && a.x <= p.x + 13 && a.y >= top - 2 && a.y <= top + 17) return { p, head: a.y <= top + 9 };
    }
    return null;
  }

  const onResize = () => { layout(); if (reduce) staticScene(); };
  const onTheme = () => {
    colors = cssColors();
    applyEnv();
    for (const [i, p] of plots.entries()) p.petal = colors.petals[i % 4];
    for (const [i, b] of butterflies.entries()) b.color = colors.wings[i % 4];
    if (reduce || !running) draw();
  };
  addEventListener('resize', onResize);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  layout();
  if (reduce) staticScene();

  return {
    restart() { if (!reduce) reset(); },
    /** Time of day (local hour, 0–24) and weather ('clear' | 'cloudy' | 'rain' | 'snow' | 'storm'). */
    setEnv(next) {
      env = { ...env, ...next };
      if (!WEATHERS.includes(env.weather)) env.weather = 'clear';
      applyEnv();
      if (reduce || !running) draw();
    },
    onSky(fn) { onSky = fn; applyEnv(); },
    /** Use the viewer's own character as the passer-by. */
    setLook(look) {
      friendLook = look;
      if (friend) Object.assign(friend, lookPalette(look || randomLook()));
      if (reduce) { reset(); staticScene(); }
    },
    play() {
      if (reduce || running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    pause() {
      running = false;
      cancelAnimationFrame(raf);
    },
    /** Hovering: he looks up at you; butterflies drift away. Returns true when over a person. */
    hover(clientX, clientY) {
      const a = toArt(clientX, clientY);
      if (!a) return false;
      for (const b of butterflies) {
        const dx = b.x + 2 - a.x;
        const dy = b.y + 1 - a.y;
        if (Math.hypot(dx, dy) < 10) { b.vx = Math.sign(dx || 1) * 0.03; b.vy = -0.02; }
      }
      const hit = personAt(a);
      if (hit) hit.p.lookUntil = clock + 600;
      return !!hit;
    },
    /** A pat on the head: a happy smile, rosy cheeks and a few floating hearts. */
    pat(clientX, clientY) {
      const a = toArt(clientX, clientY);
      const hit = a && personAt(a);
      if (!hit) return false;
      hit.p.happyUntil = clock + 1600;
      for (let i = 0; i < 3; i++) hearts.push({ x: hit.p.x + 3 + i * 3, y: topOf() - 3 - i, life: -i * 140, seed: Math.random() * 1000 });
      if (reduce) draw();
      return true;
    },
  };
}
