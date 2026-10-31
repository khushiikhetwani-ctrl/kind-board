// A small looping scene behind the intro: a gardener walks across a grassy field, sows
// seeds, waters them, flowers bloom and a bush grows fruit, and the gardener gives a fruit
// to a passer-by. Drawn on a canvas with the site's own palette; calm by design.
// In "visit" mode (the calendar) the same gardener just strolls in, says hi, and walks on.

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (t) => 1 - (1 - clamp01(t)) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;

function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    hill: v('--garden-hill', '#e3ead4'), hill2: v('--garden-hill-2', '#d6e1c4'), grass: v('--garden-grass', '#9fb889'),
    soil: v('--garden-soil', '#c9ae8c'), stem: v('--garden-stem', '#6f9a5c'), leaf: v('--garden-leaf', '#8fb878'),
    skin: v('--garden-skin', '#e8c2a0'), hair: v('--garden-hair', '#4a3426'), ink: v('--ink', '#161513'),
    shirt: v('--lav', '#8f88ee'), friend: v('--rust-2', '#b4704d'), can: v('--garden-can', '#7fa7c9'), water: v('--garden-water', '#8cc3e8'),
    petals: [v('--garden-petal-1', '#e7a7bb'), v('--garden-petal-2', '#b7aef0'), v('--garden-petal-3', '#ecc964'), v('--garden-petal-4', '#f0a983')],
    legs: v('--garden-legs', '#3c3a48'),
    fruit: v('--garden-fruit', '#e0824f'), bush: v('--garden-bush', '#7ea86a'),
  };
}
// darken/lighten a hex colour a little so pastel petals read against the grass
function shade(hex, amt) {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return hex;
  const ch = m.slice(1).map((x) => Math.round(Math.max(0, Math.min(255, parseInt(x, 16) * (1 + amt)))));
  return `rgb(${ch.join(',')})`;
}

export function startGarden(canvas, { mode = 'garden' } = {}) {
  const visit = mode === 'visit';
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let colors = palette();
  let blades = [];
  let plots = [];
  let raf = 0;
  let running = false;
  let last = 0;
  let clock = 0; // ms of scene time

  const groundY = (x) => H * (visit ? 0.7 : 0.62) + Math.sin(x * 0.0042 + 0.6) * (visit ? 5 : 9) + Math.sin(x * 0.011) * 3;

  // ---- the people
  const gardener = { x: -50, facing: 1, phase: 0, bend: 0, arm: 0, can: true, tilt: 0, holding: null, wave: 0 };
  let friend = null;
  let drops = [];
  let flying = null; // the fruit on its way from one hand to another
  let plan = [];
  let step = 0;
  let stepStart = 0;
  let fade = 1;

  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    blades = [];
    for (let x = -10; x < W + 10; x += 6) blades.push({ x: x + Math.random() * 4, h: 6 + Math.random() * 10, s: Math.random() * TAU });
    reset();
  }

  function resetVisit() {
    // a few flowers already in bloom, and a gardener passing by to say hi
    plots = [0.12, 0.31, 0.7, 0.88].map((f, i) => ({
      x: W * f + (Math.random() * 40 - 20), kind: i === 2 ? 'fruit' : 'flower', petal: colors.petals[i % colors.petals.length],
      sown: true, seedAt: 0, wateredAt: -1e6, height: 26 + Math.random() * 14, fruits: 3,
    }));
    Object.assign(gardener, { x: -40, facing: 1, bend: 0, arm: 0, can: false, tilt: 0, holding: null, wave: 0 });
    friend = null;
    drops = [];
    flying = null;
    plan = [{ kind: 'walk', to: W * (0.42 + Math.random() * 0.16) }, { kind: 'hi', dur: 2800 }, { kind: 'walk', to: W + 50 }, { kind: 'rest', dur: 26000 + Math.random() * 14000 }];
    step = 0;
    stepStart = clock;
  }

  function reset() {
    if (visit) return resetVisit();
    const n = Math.max(3, Math.min(7, Math.floor(W / 190)));
    const span = W * 0.84;
    const start = W * 0.08;
    plots = Array.from({ length: n }, (_, i) => ({
      x: start + (span / (n - 1)) * i + (Math.random() * 30 - 15),
      kind: i % 3 === 1 ? 'fruit' : 'flower',
      petal: colors.petals[i % colors.petals.length],
      sown: false, seedAt: 0, wateredAt: 0, height: 34 + Math.random() * 26, fruits: 3,
    }));
    Object.assign(gardener, { x: -50, facing: 1, bend: 0, arm: 0, can: true, tilt: 0, holding: null, wave: 0 });
    friend = null;
    drops = [];
    flying = null;
    // the day's plan: visit every plot, then share a fruit
    plan = [];
    for (const [i, p] of plots.entries()) plan.push({ kind: 'walk', to: p.x - 26 }, { kind: 'sow', plot: i, dur: 1500 }, { kind: 'water', plot: i, dur: 1900 });
    const fruitPlot = plots.findLastIndex((p) => p.kind === 'fruit');
    plan.push({ kind: 'wait', dur: 2600 });
    if (fruitPlot >= 0) plan.push({ kind: 'walk', to: plots[fruitPlot].x - 30 }, { kind: 'pick', plot: fruitPlot, dur: 1100 });
    plan.push({ kind: 'greet', dur: 0 }, { kind: 'give', dur: 1500 }, { kind: 'wave', dur: 2600 }, { kind: 'rest', dur: 5000 }, { kind: 'fadeout', dur: 1400 });
    step = 0;
    stepStart = clock;
    fade = 0;
  }

  function nextStep() {
    step++;
    stepStart = clock;
    if (step >= plan.length) reset();
  }

  function update(dt) {
    clock += dt;
    fade = visit ? 1 : Math.min(1, fade + dt / 900);
    const s = plan[step];
    const t = clock - stepStart;
    const g = gardener;
    g.bend = lerp(g.bend, 0, 0.08);
    g.arm = lerp(g.arm, 0, 0.1);
    g.tilt = lerp(g.tilt, 0, 0.1);
    g.wave = Math.max(0, g.wave - dt / 600);

    if (s.kind === 'walk') {
      const dir = Math.sign(s.to - g.x) || 1;
      g.facing = dir;
      g.x += dir * dt * 0.05;
      g.phase += dt * 0.011;
      if ((dir > 0 && g.x >= s.to) || (dir < 0 && g.x <= s.to)) { g.x = s.to; nextStep(); }
    } else {
      g.phase = lerp(g.phase, Math.round(g.phase / Math.PI) * Math.PI, 0.15);
    }
    if (s.kind === 'sow') {
      const k = t / s.dur;
      g.bend = Math.sin(clamp01(k) * Math.PI) * 0.7;
      g.arm = g.bend;
      const p = plots[s.plot];
      if (k > 0.45 && !p.sown) { p.sown = true; p.seedAt = clock; }
      if (t >= s.dur) nextStep();
    }
    if (s.kind === 'water') {
      const k = t / s.dur;
      g.tilt = Math.sin(clamp01(k) * Math.PI) * 0.9;
      g.arm = 0.35;
      if (k > 0.15 && k < 0.85 && Math.random() < dt / 45) {
        const spout = canTip(g);
        drops.push({ x: spout.x, y: spout.y, vx: g.facing * (0.03 + Math.random() * 0.03), vy: 0.02, life: 0 });
      }
      if (t >= s.dur) { plots[s.plot].wateredAt = clock; nextStep(); }
    }
    if (s.kind === 'wait' && t >= s.dur) nextStep();
    if (s.kind === 'hi') {
      g.wave = 1;
      if (t >= s.dur) nextStep();
    }
    if (s.kind === 'pick') {
      const k = t / s.dur;
      g.arm = Math.sin(clamp01(k) * Math.PI) * 1.1;
      g.can = false;
      if (k > 0.5 && !g.holding) { g.holding = 'fruit'; plots[s.plot].fruits--; }
      if (t >= s.dur) nextStep();
    }
    if (s.kind === 'greet') {
      if (!friend) friend = { x: W + 40, facing: -1, phase: 0, holding: null, leaving: false, wave: 0 };
      g.facing = 1;
      const target = g.x + 52;
      friend.x -= dt * 0.05;
      friend.phase += dt * 0.011;
      if (friend.x <= target) { friend.x = target; friend.phase = 0; nextStep(); }
    }
    if (s.kind === 'give') {
      const k = t / s.dur;
      g.arm = 0.55;
      if (!flying && k > 0.25) { flying = { t: 0 }; g.holding = null; }
      if (flying) flying.t = clamp01((k - 0.25) / 0.5);
      if (t >= s.dur) { flying = null; friend.holding = 'fruit'; nextStep(); }
    }
    if (s.kind === 'wave') {
      g.wave = 1;
      if (friend) friend.wave = 1;
      if (t >= s.dur) { friend.leaving = true; nextStep(); }
    }
    if (s.kind === 'rest' && t >= s.dur) nextStep();
    if (s.kind === 'fadeout') {
      fade = 1 - clamp01(t / s.dur);
      if (t >= s.dur) nextStep();
    }
    if (friend?.leaving) {
      friend.facing = 1;
      friend.x += dt * 0.05;
      friend.phase += dt * 0.011;
      friend.wave = Math.max(0, friend.wave - dt / 600);
    }
    for (const d of drops) { d.life += dt; d.vy += dt * 0.0012; d.x += d.vx * dt; d.y += d.vy * dt; }
    drops = drops.filter((d) => d.y < groundY(d.x) - 2);
  }

  // ---- drawing helpers
  function canTip(g) {
    const hip = { x: g.x, y: groundY(g.x) - 26 };
    const shoulder = { x: hip.x + Math.sin(g.bend) * 22 * g.facing, y: hip.y - Math.cos(g.bend) * 22 };
    const hand = { x: shoulder.x + g.facing * 12, y: shoulder.y + 10 };
    return { x: hand.x + g.facing * (14 + g.tilt * 4), y: hand.y - 2 + g.tilt * 8 };
  }

  function person(p, shirt, opts = {}) {
    const c = colors;
    const gy = groundY(p.x);
    const swing = Math.sin(p.phase) * 0.45;
    const hipY = gy - 26;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // legs
    ctx.strokeStyle = c.legs;
    ctx.lineWidth = 4;
    for (const sgn of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(p.x, hipY);
      ctx.lineTo(p.x + Math.sin(swing * sgn) * 13, gy - 1);
      ctx.stroke();
    }
    // upper body leans forward when bending
    const bend = opts.bend || 0;
    const sx = p.x + Math.sin(bend) * 22 * p.facing;
    const sy = hipY - Math.cos(bend) * 22;
    ctx.strokeStyle = shirt;
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(p.x, hipY - 3);
    ctx.lineTo(sx, sy + 4);
    ctx.stroke();
    // head + hair
    const hx = sx + Math.sin(bend) * 11 * p.facing;
    const hy = sy - Math.cos(bend) * 11;
    ctx.fillStyle = c.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = c.hair;
    ctx.beginPath();
    ctx.arc(hx - p.facing * 1.5, hy - 2, 8, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    // arm (reaches forward, down when bending, up when waving)
    const reach = opts.arm || 0;
    const wave = opts.wave || 0;
    ctx.strokeStyle = c.skin;
    ctx.lineWidth = 4;
    const hand = wave > 0.05
      ? { x: sx + p.facing * 6, y: sy - 16 - Math.sin(clock / 120) * 3 * wave }
      : { x: sx + p.facing * (6 + reach * 10), y: sy + 12 + reach * 12 };
    ctx.beginPath();
    ctx.moveTo(sx, sy + 2);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();
    if (opts.can) {
      ctx.save();
      ctx.translate(hand.x + p.facing * 3, hand.y + 2);
      ctx.rotate(p.facing * (opts.tilt || 0) * 0.7);
      ctx.fillStyle = c.can;
      ctx.beginPath();
      ctx.roundRect(-5 * p.facing - (p.facing < 0 ? 12 : 0), -6, 12, 11, 2);
      ctx.fill();
      ctx.strokeStyle = c.can;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.facing * 6, -1);
      ctx.lineTo(p.facing * 13, -6);
      ctx.stroke();
      ctx.restore();
    }
    if (opts.holding === 'fruit') fruitDot(hand.x + p.facing * 2, hand.y - 4, 4.5);
    return hand;
  }

  function speech(p, text, alpha) {
    if (alpha <= 0) return;
    const x = p.x + 16;
    const y = groundY(p.x) - 84;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 13px Figtree, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--raised').trim() || '#fff';
    ctx.strokeStyle = colors.legs;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y - 13, w, 24, 12);
    ctx.moveTo(x + 8, y + 11);
    ctx.lineTo(x + 2, y + 17);
    ctx.lineTo(x + 15, y + 11);
    ctx.fill();
    ctx.fillStyle = colors.legs;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 9, y);
    ctx.restore();
  }

  function fruitDot(x, y, r) {
    ctx.fillStyle = colors.fruit;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, TAU);
    ctx.fill();
  }

  function plant(p) {
    const c = colors;
    const gy = groundY(p.x);
    if (p.sown) {
      ctx.fillStyle = c.soil;
      ctx.beginPath();
      ctx.ellipse(p.x, gy + 1, 14, 4, 0, 0, TAU);
      ctx.fill();
    }
    if (p.sown && !p.wateredAt) {
      const fall = clamp01((clock - p.seedAt) / 350);
      ctx.fillStyle = c.hair;
      ctx.beginPath();
      ctx.arc(p.x, lerp(gy - 16, gy - 1, fall), 2, 0, TAU);
      ctx.fill();
    }
    if (!p.wateredAt) return;
    const grow = ease((clock - p.wateredAt) / 5200);
    const h = p.height * grow;
    const sway = Math.sin(clock / 900 + p.x) * 2 * grow;
    if (p.kind === 'fruit') {
      // a round little bush with fruit
      const r = 6 + 14 * grow;
      ctx.fillStyle = c.bush;
      ctx.beginPath();
      ctx.arc(p.x - r * 0.45 + sway * 0.3, gy - r * 0.8, r * 0.75, 0, TAU);
      ctx.arc(p.x + r * 0.45 + sway * 0.3, gy - r * 0.8, r * 0.75, 0, TAU);
      ctx.arc(p.x + sway * 0.3, gy - r * 1.3, r * 0.8, 0, TAU);
      ctx.fill();
      const ripe = clamp01((grow - 0.8) / 0.2);
      const spots = [[-0.5, -0.9], [0.45, -1.1], [0, -1.6]];
      for (let i = 0; i < p.fruits; i++) if (ripe > 0) fruitDot(p.x + spots[i][0] * r + sway * 0.3, gy + spots[i][1] * r, 3.6 * ripe);
      return;
    }
    // stem + leaves
    ctx.strokeStyle = c.stem;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(p.x, gy);
    ctx.quadraticCurveTo(p.x + sway * 0.5 + 3, gy - h * 0.55, p.x + sway, gy - h);
    ctx.stroke();
    if (grow > 0.25) {
      ctx.fillStyle = c.leaf;
      for (const [dir, at] of [[1, 0.35], [-1, 0.55]]) {
        ctx.beginPath();
        ctx.ellipse(p.x + dir * 6 + sway * at, gy - h * at, 6 * grow, 2.6 * grow, dir * -0.5, 0, TAU);
        ctx.fill();
      }
    }
    const bloom = clamp01((grow - 0.7) / 0.3);
    if (bloom > 0) {
      const fx = p.x + sway;
      const fy = gy - h;
      ctx.fillStyle = p.petal;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + clock / 6000;
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * 6 * bloom, fy + Math.sin(a) * 6 * bloom, 4.4 * bloom, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = shade(colors.fruit, 0.1);
      ctx.beginPath();
      ctx.arc(fx, fy, 3.2 * bloom, 0, TAU);
      ctx.fill();
    }
  }

  function draw() {
    const c = colors;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = fade;
    // far hill
    ctx.fillStyle = c.hill2;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 12) ctx.lineTo(x, H * 0.5 + Math.sin(x * 0.0026 + 2) * 16);
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.globalAlpha = 1;
    // near field
    ctx.fillStyle = c.hill;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, groundY(x));
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.globalAlpha = fade;
    for (const p of plots) plant(p);
    // grass in front of the plants' roots
    ctx.strokeStyle = c.grass;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of blades) {
      const gy = groundY(b.x) + 2;
      const lean = Math.sin(clock / 1400 + b.s) * 2.2;
      ctx.moveTo(b.x, gy);
      ctx.quadraticCurveTo(b.x + lean * 0.4, gy - b.h * 0.6, b.x + lean, gy - b.h);
    }
    ctx.stroke();
    // water drops
    ctx.fillStyle = c.water;
    for (const d of drops) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.8, 0, TAU);
      ctx.fill();
    }
    const g = gardener;
    if (plan[step]?.kind === 'hi') speech(g, 'hi!', clamp01((clock - stepStart) / 300) * (1 - clamp01((clock - stepStart - plan[step].dur + 300) / 300)));
    const gHand = person(g, c.shirt, { bend: g.bend, arm: g.arm, can: g.can, tilt: g.tilt, holding: g.holding, wave: g.wave });
    if (friend && friend.x < W + 60) {
      const fHand = person(friend, c.friend, { holding: friend.holding, wave: friend.wave, arm: plan[step]?.kind === 'give' ? 0.55 : 0 });
      if (flying) {
        const k = ease(flying.t);
        fruitDot(lerp(gHand.x, fHand.x, k), lerp(gHand.y, fHand.y, k) - Math.sin(k * Math.PI) * 26, 4.5);
      }
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
    // reduced motion: a still garden in full bloom, the gift already given
    for (const p of plots) { p.sown = true; p.wateredAt = -1e6; }
    clock = 0;
    gardener.x = W * 0.42;
    gardener.can = false;
    friend = visit ? null : { x: W * 0.42 + 52, facing: -1, phase: 0, holding: 'fruit', wave: 0 };
    plan = [{ kind: 'rest', dur: Infinity }];
    step = 0;
    fade = 1;
    draw();
  }

  const onResize = () => { layout(); if (reduce) staticScene(); };
  const onTheme = () => { colors = palette(); if (reduce || !running) draw(); };
  addEventListener('resize', onResize);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  layout();
  if (reduce) staticScene();

  return {
    restart() { if (!reduce) reset(); },
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
  };
}
