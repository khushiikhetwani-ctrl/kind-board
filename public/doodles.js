// Original hand-drawn line doodles, shown as die-cut paper stickers (white cut edge + soft shadow).
// Each: [stroke color, paper tint, SVG inner markup on a 64×64 canvas].
export const DOODLES = {
  heart: ['#b3305f', '#fbd3e4', '<path d="M32 51c-17-11-22-21-19-29 3-8 13-10 19-2 6-8 16-6 19 2 3 8-2 18-19 29z"/><path d="M21 25c1-3 4-4 6-3"/>'],
  star: ['#5b4fd0', '#e3defc', '<path d="M32 9l6.4 15.6 16.6 1.2-12.7 10.8 4 16.4L32 44.2 17.7 53l4-16.4L9 25.8l16.6-1.2z"/>'],
  sparkle: ['#c2410c', '#fde3c8', '<path d="M30 8c1.6 14 6 19.5 22 22-16 2.5-20.4 8-22 22-1.6-14-6-19.5-22-22 16-2.5 20.4-8 22-22z"/><path d="M50 8v8M46 12h8"/>'],
  sun: ['#b7791f', '#fdf0bf', '<circle cx="32" cy="32" r="10"/><path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5"/>'],
  moon: ['#4c51bf', '#dfe3fb', '<path d="M41 10a22 22 0 1 0 14 30 17 17 0 0 1-14-30z"/><path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>'],
  flower: ['#be185d', '#fbd5e8', '<circle cx="32" cy="27" r="5"/><path d="M32 22c-4-8 4-14 6-6M37 27c8-3 12 6 4 7M35 32c4 7-4 12-6 5M28 32c-6 6-13-1-6-5M27 26c-8-1-7-10 1-7"/><path d="M32 33v22M32 46c-5-4-11-3-12 0M32 50c4-4 10-4 11-1"/>'],
  leaf: ['#3f7d3a', '#dff2c7', '<path d="M13 51c0-25 16-38 39-38 0 23-13 38-39 38z"/><path d="M13 51l27-27M26 38h9M31 33v-8"/>'],
  cloud: ['#2b6cb0', '#d8ebfb', '<path d="M18 45h28a10 10 0 0 0-1-20 13 13 0 0 0-25 3 9 9 0 0 0-2 17z"/><path d="M24 52l-2 4M34 52l-2 4M44 52l-2 4"/>'],
  cup: ['#8a4b2a', '#f6e4d3', '<path d="M13 27h31v12a12 12 0 0 1-12 12h-7a12 12 0 0 1-12-12z"/><path d="M44 30h3a5 5 0 0 1 0 10h-3M23 20c-2-4 2-6 0-10M33 20c-2-4 2-6 0-10"/>'],
  letter: ['#9a4a1f', '#fdf1cc', '<rect x="10" y="18" width="44" height="30" rx="3"/><path d="M11 20l21 16 21-16"/><path d="M41 42c2-3 6-3 6 0s-3 4-6 6c-3-2-6-3-6-6s4-3 6 0" transform="translate(4 -10) scale(.7)"/>'],
  music: ['#6b46c1', '#ebe3fb', '<path d="M24 46V15l24-5v30"/><circle cx="19" cy="46" r="5.5"/><circle cx="43" cy="40" r="5.5"/><path d="M24 22l24-5"/>'],
  smile: ['#2f855a', '#d8f2e1', '<circle cx="32" cy="32" r="21"/><path d="M23 37c4 7 14 7 18 0M25 26v2M39 26v2"/>'],
  rainbow: ['#c2410c', '#fde7d6', '<path d="M8 46a24 24 0 0 1 48 0M16 46a16 16 0 0 1 32 0M24 46a8 8 0 0 1 16 0"/><path d="M6 46h10M48 46h10"/>'],
  plant: ['#3f7d3a', '#e6f4c3', '<path d="M21 40h22l-3 14H24z"/><path d="M32 40V24M32 31c-8 0-12-6-12-12 8 0 12 4 12 12M32 27c8 0 12-6 12-12-8 0-12 4-12 12"/>'],
};

const NS = 'http://www.w3.org/2000/svg';
/** A doodle as a paper sticker ("heart") or a glossy fridge magnet ("heart:magnet"). */
export function doodleEl(content) {
  const [name, style] = String(content).split(':');
  const magnet = style === 'magnet';
  const [stroke, tint, inner] = DOODLES[name] || DOODLES.heart;
  const wrap = document.createElement('span');
  wrap.className = magnet ? 'doodle magnet' : 'doodle';
  wrap.style.setProperty('--tint', tint);
  wrap.style.setProperty('--dink', stroke);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  // magnets are moulded plastic in the doodle's colour, with the design raised in white
  svg.setAttribute('stroke', magnet ? '#ffffff' : stroke);
  svg.setAttribute('stroke-width', magnet ? '3.4' : '2.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Static, trusted artwork from this file only, never user content.
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${NS}">${inner}</svg>`, 'image/svg+xml');
  svg.append(...parsed.documentElement.childNodes);
  wrap.append(svg);
  return wrap;
}
