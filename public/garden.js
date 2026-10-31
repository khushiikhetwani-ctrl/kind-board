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
  let raf = 0;
  let running = false;
  let last = 0;
  let clock = 0;

  const groundY = () => Math.round(H * (visit ? 0.74 : 0.78));
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
    clouds = Array.from({ length: Math.max(2, Math.floor(W / 120)) }, (_, i) => ({ x: (W / 2.2) * i + Math.random() * 40, y: 3 + Math.floor(Math.random() * Math.max(1, gy * 0.3)), speed: 0.0012 + Math.random() * 0.001 }));
    reset();
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
      makeButterflies(2);
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
    makeButterflies(3);
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
      if (s.kind === 'water') {
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

  // ---- drawing
  function drawPerson(p, pal) {
    const top = topOf();
    const face = clock < p.happyUntil ? 'happy' : clock < p.lookUntil ? 'up' : 'normal';
    // rosy cheeks, a little brighter when he's happy
    const cheeks = { c: face === 'happy' ? colors.heart : colors.cheek, ...pal };
    sprite(kidRows(p.frame, face, p.style || 'bowl'), Math.round(p.x), top, cheeks, p.facing < 0);
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
      if (grow > 0.85) {
        ctx.fillStyle = colors.fruit;
        const spots = [[-3, -5], [2, -6], [0, -3]];
        for (let i = 0; i < p.fruits; i++) px(p.x + spots[i][0], gy + spots[i][1], 2, 2);
      }
      return;
    }
    const h = Math.max(1, Math.round(p.height * grow));
    const sway = grow > 0.9 && Math.floor(clock / 700 + p.x) % 2 ? 1 : 0;
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
    // blocky far hills and slow clouds
    ctx.fillStyle = c.hill;
    for (let x = 0; x < W; x += 2) {
      const hgt = Math.round(10 + Math.sin(x * 0.03 + 1) * 6 + Math.sin(x * 0.011) * 5);
      px(x, gy - hgt, 2, hgt);
    }
    ctx.fillStyle = c.hill2;
    for (let x = 0; x < W; x += 2) {
      const hgt = Math.round(5 + Math.sin(x * 0.05 + 3) * 3);
      px(x, gy - hgt, 2, hgt);
    }
    ctx.globalAlpha = 0.85;
    for (const cl of clouds) sprite(CLOUD, Math.round(cl.x), cl.y);
    ctx.globalAlpha = 1;
    // ground: a grass edge, then soil with pebbles
    ctx.fillStyle = c.dirt;
    px(0, gy, W, H - gy);
    ctx.fillStyle = c.dirtDark;
    for (const pb of pebbles) px(pb.x, pb.y, 2, 1);
    ctx.fillStyle = c.grass;
    px(0, gy, W, 2);
    ctx.fillStyle = c.grassDark;
    for (let x = 0; x < W; x += 4) px(x + ((x / 4) % 2), gy + 2, 2, 1);
    const sway = Math.floor(clock / 650) % 2;
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
