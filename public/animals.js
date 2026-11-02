// Pixel animal characters. Every identity is an animal ("Anonymous Swan"), and people who share
// an animal are told apart by a colour tint and an accessory: 6 x 6 = 36 unique versions each.
// Heads are built from one round template plus each animal's features, at 12 x 9 pixels, so they
// fit the same bodies as the custom characters. All original artwork.

// fur, accent, and optional: muzzle (light face), beak, extra colour, ear style, features
const A = (fur, accent, opts = {}) => ({ fur, accent, ...opts });
export const ANIMAL_SPECS = {
  Dog: A('#c8956a', '#8a5a3a', { ears: 'floppy', muzzle: '#f1dcc4' }),
  Cat: A('#f0a35e', '#c9733a', { ears: 'pointy', feats: ['stripes'] }),
  Fox: A('#e8743b', '#3a2a24', { ears: 'pointy', muzzle: '#fff4ea' }),
  Panda: A('#fbfbf8', '#2b2b33', { ears: 'round', earColor: 'F', feats: ['patches'] }),
  Koala: A('#9aa3ad', '#6b7480', { ears: 'round', bigNose: true }),
  Tiger: A('#f2994a', '#3a2a24', { ears: 'round', muzzle: '#fff8ef', feats: ['stripes'] }),
  Lion: A('#e2b04a', '#b86f2c', { ears: 'round', feats: ['mane'] }),
  Frog: A('#7fc46a', '#4f8f43', { ears: 'none', feats: ['frog'] }),
  Owl: A('#b08860', '#7a5a3c', { ears: 'tufts', beak: '#e9b44c', feats: ['owlface'] }),
  Penguin: A('#2f3440', '#2f3440', { ears: 'none', beak: '#f2a13a', feats: ['face'] }),
  Otter: A('#9c6b45', '#6b4a30', { ears: 'round', muzzle: '#e8d2b8' }),
  Rabbit: A('#e9e1d8', '#f3b6c4', { ears: 'long' }),
  Hamster: A('#f1b878', '#c98c4c', { ears: 'round', muzzle: '#fff3e0' }),
  Bear: A('#8b5e3c', '#5e3d24', { ears: 'round', muzzle: '#d7b48e' }),
  Hedgehog: A('#e2c49a', '#6b4a30', { ears: 'none', feats: ['spikes'] }),
  Turtle: A('#8fc46a', '#5a7d3c', { ears: 'none', extra: '#7a5a3c', feats: ['shell'] }),
  Octopus: A('#e98ab5', '#c45f8d', { ears: 'none', feats: ['tentacles'] }),
  Whale: A('#6a9fd8', '#4a78b0', { ears: 'none', muzzle: '#dbe9f7', feats: ['fins'] }),
  Dolphin: A('#8fb2cc', '#6890ad', { ears: 'none', muzzle: '#e3eef5', feats: ['fins'] }),
  Butterfly: A('#4a3e56', '#2f2638', { ears: 'none', extra: '#f2a6c8', feats: ['wings', 'antennae'] }),
  Bee: A('#f2c94c', '#3a3040', { ears: 'none', extra: '#e6f2fb', feats: ['bee', 'wings', 'antennae'] }),
  Ladybug: A('#e5483f', '#2b2b33', { ears: 'none', feats: ['spots', 'antennae'] }),
  Sloth: A('#a88b6c', '#6b5440', { ears: 'none', muzzle: '#e6d4bc', feats: ['mask'] }),
  Raccoon: A('#9a9ca4', '#3a3a44', { ears: 'pointy', muzzle: '#eeeef0', feats: ['mask'] }),
  Deer: A('#b8804e', '#8a5a34', { ears: 'pointy', muzzle: '#f0e0cc', extra: '#6b4a30', feats: ['antlers'] }),
  Duck: A('#f7e27a', '#d9b53a', { ears: 'none', beak: '#f2913a' }),
  Swan: A('#fbfbf8', '#d9d9d2', { ears: 'none', beak: '#f2913a', feats: ['crest'] }),
  Flamingo: A('#f4a3b8', '#d97a96', { ears: 'none', beak: '#2b2b33' }),
  Parrot: A('#49b26b', '#e5483f', { ears: 'none', beak: '#f2c94c', feats: ['crest'] }),
  Seal: A('#8e9aa6', '#6b7682', { ears: 'none', muzzle: '#c9d2da' }),
  Giraffe: A('#f0c75e', '#b8803c', { ears: 'pointy', extra: '#8a5a34', feats: ['spots', 'ossicones'] }),
  Elephant: A('#a7adb6', '#848a94', { ears: 'floppy', feats: ['trunk'] }),
  Snail: A('#f0d8b0', '#c98e5a', { ears: 'none', extra: '#c98e5a', feats: ['shell', 'antennae'] }),
  Crab: A('#ea6a4a', '#b8402a', { ears: 'none', extra: '#ea6a4a', feats: ['claws', 'antennae'] }),
  Mouse: A('#b9b4ae', '#f3b6c4', { ears: 'round', earColor: 'F' }),
  Wolf: A('#8d939c', '#5d636c', { ears: 'pointy', muzzle: '#e4e6ea' }),
  Moose: A('#7a5236', '#5a3a22', { ears: 'pointy', muzzle: '#9a7050', extra: '#d2b48a', feats: ['antlers'] }),
  Heron: A('#c6ced8', '#8e9aa6', { ears: 'none', beak: '#e9b44c', feats: ['crest'] }),
  Lynx: A('#d2a679', '#3a2a24', { ears: 'tufts', muzzle: '#f4e6d4', feats: ['spots'] }),
  Badger: A('#4a4a52', '#2e2e34', { ears: 'round', muzzle: '#f4f4f0', feats: ['badger'] }),
  Robin: A('#8a6a50', '#e9734a', { ears: 'none', beak: '#e9b44c', feats: ['chest'] }),
  Sparrow: A('#a77c55', '#6b4a30', { ears: 'none', beak: '#d7b48e', feats: ['cap'] }),
  Moth: A('#c9b89a', '#9a8a6c', { ears: 'none', extra: '#a9977a', feats: ['wings', 'antennae'] }),
  Lamb: A('#f3ece0', '#3a3040', { ears: 'floppy', feats: ['wool'] }),
  Pony: A('#a0704a', '#3a2a24', { ears: 'pointy', muzzle: '#c89a70', feats: ['mane'] }),
  Wren: A('#9c7656', '#6b4a30', { ears: 'none', beak: '#6b4a30', feats: ['cap'] }),
  Finch: A('#f2d04a', '#3a3040', { ears: 'none', beak: '#e98a4a', feats: ['cap'] }),
  Puffin: A('#2f3440', '#2f3440', { ears: 'none', beak: '#e5483f', feats: ['face'] }),
};

const TINTS = [null, ['#ffffff', 0.28], ['#2a2420', 0.2], ['#f4a3c0', 0.32], ['#8fb8ef', 0.32], ['#9fd9b0', 0.32]];
export const TINT_NAMES = ['classic colours', 'pale', 'deep-toned', 'rosy', 'sky-tinted', 'minty'];
export const ACCESSORIES = ['none', 'bow', 'glasses', 'beanie', 'flower', 'bandana'];
const ACC_COLORS = ['#e86a8a', '#5b8def', '#f2b134', '#7a5cd6', '#3fb08f', '#e2574c'];
const SUITS = [['#5fb7a1', '#8fd3c1'], ['#8f88ee', '#bdb8fb'], ['#f0a27a', '#f7c6a8'], ['#e7a7bb', '#f4ccd8'], ['#6a9fd8', '#a3c6ee'], ['#e9c46a', '#f3dc9c']];
export const VARIANTS = 36;

const mix = (a, b, t) => {
  const A1 = parseInt(a.slice(1), 16);
  const B1 = parseInt(b.slice(1), 16);
  return `#${[16, 8, 0].map((s) => Math.round(((A1 >> s) & 255) + (((B1 >> s) & 255) - ((A1 >> s) & 255)) * t).toString(16).padStart(2, '0')).join('')}`;
};

export function describeVariant(variant = 0) {
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  const acc = ACCESSORIES[Math.floor(v / 6)];
  return `${TINT_NAMES[v % 6]}${acc === 'none' ? '' : `, with a ${acc}`}`;
}

/** A 12x9 head for an animal + variant, with its palette, and the matching jumpsuit colours. */
export function animalHead(animal, variant = 0) {
  const spec = ANIMAL_SPECS[animal];
  if (!spec) return null;
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  const tint = TINTS[v % 6];
  const acc = Math.floor(v / 6);
  const g = [
    '............', '............', '...ffffff...', '..ffffffff..', '.ffeffffeff.',
    '.fcffffffcf.', '.ffffffffff.', '..ffffffff..', '....ffff....',
  ].map((r) => r.split(''));
  const set = (pts, k) => { for (const [x, y] of pts) if (g[y] && x >= 0 && x < 12) g[y][x] = k; };
  const feats = new Set(spec.feats || []);

  // ears
  const ear = spec.earColor || 'f';
  if (spec.ears === 'pointy') set([[2, 0], [2, 1], [3, 1], [2, 2], [9, 0], [9, 1], [8, 1], [9, 2]], ear);
  if (spec.ears === 'round') set([[1, 1], [2, 1], [1, 2], [2, 2], [9, 1], [10, 1], [9, 2], [10, 2]], ear);
  if (spec.ears === 'long') { set([[3, 0], [3, 1], [8, 0], [8, 1]], 'f'); set([[4, 0], [4, 1], [7, 0], [7, 1]], 'F'); }
  if (spec.ears === 'tufts') { set([[2, 1], [2, 2], [9, 1], [9, 2]], 'f'); set([[1, 0], [10, 0]], 'F'); }
  if (spec.ears === 'floppy') set([[1, 3], [0, 4], [0, 5], [0, 6], [10, 3], [11, 4], [11, 5], [11, 6]], 'F');

  // face
  if (spec.muzzle) set([[4, 5], [5, 5], [6, 5], [7, 5], [4, 6], [5, 6], [6, 6], [7, 6]], 'w');
  if (feats.has('face')) set([[2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [2, 4], [4, 4], [5, 4], [6, 4], [7, 4], [9, 4], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6]], 'w');
  if (spec.beak) set([[5, 5], [6, 5], [5, 6], [6, 6]], 'y');
  else if (feats.has('trunk')) set([[5, 6], [6, 6], [5, 7], [5, 8], [4, 8]], 'F');
  else set(spec.bigNose ? [[5, 5], [6, 5], [5, 6], [6, 6]] : [[5, 5], [6, 5]], 'n');

  // features
  if (feats.has('stripes')) set([[5, 2], [6, 2], [2, 3], [9, 3], [1, 5], [10, 5]], 'F');
  if (feats.has('mask') || feats.has('patches')) set([[2, 4], [4, 4], [7, 4], [9, 4]], 'F');
  if (feats.has('patches')) set([[3, 5], [8, 5]], 'F');
  if (feats.has('spots')) set([[4, 3], [8, 3], [2, 6], [9, 6], [7, 2]], 'F');
  if (feats.has('antlers')) set([[1, 0], [3, 0], [2, 1], [8, 0], [10, 0], [9, 1]], 'x');
  if (feats.has('ossicones')) set([[4, 0], [4, 1], [7, 0], [7, 1]], 'x');
  if (feats.has('shell')) set([[4, 1], [5, 1], [6, 1], [7, 1], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2]], 'x');
  if (feats.has('wings')) set([[0, 3], [0, 4], [0, 5], [1, 6], [11, 3], [11, 4], [11, 5], [10, 6]], 'x');
  if (feats.has('tentacles')) set([[1, 7], [10, 7], [2, 8], [4, 8], [7, 8], [9, 8]], 'f');
  if (feats.has('spikes')) { set([[3, 0], [5, 0], [7, 0], [9, 0], [2, 1], [4, 1], [6, 1], [8, 1], [10, 1]], 'F'); set([[2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2]], 'F'); }
  if (feats.has('wool')) set([[3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [2, 2], [3, 2], [5, 2], [6, 2], [8, 2], [9, 2]], 'w');
  if (feats.has('mane')) set([[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [1, 2], [10, 2], [0, 3], [0, 4], [0, 5], [0, 6], [11, 3], [11, 4], [11, 5], [11, 6], [1, 7], [10, 7]], 'F');
  if (feats.has('fins')) set([[5, 0], [5, 1], [6, 1]], 'F');
  if (feats.has('claws')) set([[0, 5], [0, 6], [1, 6], [11, 5], [11, 6], [10, 6]], 'x');
  if (feats.has('antennae')) set([[3, 0], [4, 1], [8, 0], [7, 1]], 'e');
  if (feats.has('crest')) set([[6, 0], [5, 1], [6, 1]], 'F');
  if (feats.has('frog')) set([[2, 2], [3, 1], [8, 1], [9, 2]], 'f');
  if (feats.has('owlface')) set([[2, 4], [4, 4], [7, 4], [9, 4], [3, 3], [8, 3]], 'w');
  if (feats.has('badger')) set([[5, 2], [6, 2], [5, 3], [6, 3], [5, 4], [6, 4]], 'w');
  if (feats.has('chest')) set([[2, 6], [3, 6], [4, 6], [7, 6], [8, 6], [9, 6], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7]], 'F');
  if (feats.has('cap')) set([[3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2]], 'F');
  if (feats.has('bee')) set([[3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [2, 6], [3, 6], [8, 6], [9, 6]], 'F');

  // accessory (drawn last so it sits on top)
  if (acc === 1) set([[8, 1], [10, 1], [8, 2], [10, 2]], 'a'), set([[9, 1]], 'A');
  if (acc === 2) set([[2, 4], [4, 4], [7, 4], [9, 4], [5, 4], [6, 4]], 'g');
  if (acc === 3) { set([[3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2]], 'a'); set([[5, 0], [6, 0]], 'A'); }
  if (acc === 4) { set([[1, 1], [3, 1], [2, 0], [2, 2]], 'a'); set([[2, 1]], 'y'); }
  if (acc === 5) set([[2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8]], 'a');

  const tone = (c) => (tint ? mix(c, tint[0], tint[1]) : c);
  const accColor = ACC_COLORS[(v + acc) % ACC_COLORS.length];
  const pal = {
    f: tone(spec.fur), F: tone(spec.accent), w: spec.muzzle || '#fbfaf6', y: spec.beak || '#f2c94c', x: spec.extra || tone(spec.accent),
    n: '#3a2a2e', a: accColor, A: mix(accColor, '#000000', 0.25), g: '#2b2228',
    s: tone(spec.fur), // paws
  };
  return { rows: g.map((r) => r.join('')), pal, suit: SUITS[(v + Math.floor(v / 6)) % SUITS.length] };
}

const cache = new Map();
/** Head-and-shoulders portrait (tiny PNG) of an animal + variant. */
export function animalPortrait(animal, variant = 0) {
  const key = `${animal}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const head = animalHead(animal, variant);
  if (!head) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const shoulders = ['..jjjzjjjj..', '.sjjjzjjjjs.', '.sjjjzjjjjs.', '..jjjjjjjj..'];
  const pal = { e: '#2b2228', c: '#ef7a8a', ...head.pal, j: head.suit[0], z: head.suit[1] };
  [...head.rows, ...shoulders].forEach((row, j) => [...row].forEach((k, i) => {
    if (k === '.') return;
    ctx.fillStyle = pal[k] || '#2b2228';
    ctx.fillRect(i + 2, j + 2, 1, 1);
  }));
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
