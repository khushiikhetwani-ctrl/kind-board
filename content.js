// Curated daily content: encouraging quotes and the word-play tile bank.
// Quotes are hand-picked and attributed to their verified sources (no "internet misattributions").

export const QUOTES = [
  ['Friendship is born at that moment when one person says to another, “What! You too? I thought I was the only one.”', 'C. S. Lewis', 'The Four Loves'],
  ['We’re all just walking each other home.', 'Ram Dass'],
  ['In the depth of winter, I finally learned that within me there lay an invincible summer.', 'Albert Camus'],
  ['Hope is the thing with feathers that perches in the soul.', 'Emily Dickinson'],
  ['Isn’t it nice to think that tomorrow is a new day with no mistakes in it yet?', 'L. M. Montgomery', 'Anne of Green Gables'],
  ['The best way out is always through.', 'Robert Frost'],
  ['There is a crack in everything. That’s how the light gets in.', 'Leonard Cohen', 'Anthem'],
  ['Let everything happen to you: beauty and terror. Just keep going. No feeling is final.', 'Rainer Maria Rilke'],
  ['You must do the thing you think you cannot do.', 'Eleanor Roosevelt'],
  ['Not all those who wander are lost.', 'J. R. R. Tolkien'],
  ['There is no greater agony than bearing an untold story inside you.', 'Maya Angelou'],
  ['I can be changed by what happens to me. But I refuse to be reduced by it.', 'Maya Angelou'],
  ['Owning our story and loving ourselves through that process is the bravest thing that we will ever do.', 'Brené Brown'],
  ['Rock bottom became the solid foundation on which I rebuilt my life.', 'J. K. Rowling'],
  ['The sun himself is weak when he first rises, and gathers strength and courage as the day gets on.', 'Charles Dickens', 'The Old Curiosity Shop'],
  ['And now that you don’t have to be perfect, you can be good.', 'John Steinbeck', 'East of Eden'],
  ['I am not afraid of storms, for I am learning how to sail my ship.', 'Louisa May Alcott', 'Little Women'],
  ['We are all in the gutter, but some of us are looking at the stars.', 'Oscar Wilde'],
  ['How wonderful it is that nobody need wait a single moment before starting to improve the world.', 'Anne Frank'],
  ['Tell me, what is it you plan to do with your one wild and precious life?', 'Mary Oliver', 'The Summer Day'],
  ['You only have to let the soft animal of your body love what it loves.', 'Mary Oliver', 'Wild Geese'],
  ['Alone we can do so little; together we can do so much.', 'Helen Keller'],
  ['Although the world is full of suffering, it is full also of the overcoming of it.', 'Helen Keller'],
  ['Caring for myself is not self-indulgence, it is self-preservation.', 'Audre Lorde'],
  ['The world breaks everyone and afterward many are strong at the broken places.', 'Ernest Hemingway'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Hold fast to dreams, for if dreams die, life is a broken-winged bird that cannot fly.', 'Langston Hughes'],
  ['A ship in harbor is safe, but that is not what ships are built for.', 'John A. Shedd'],
  ['Life shrinks or expands in proportion to one’s courage.', 'Anaïs Nin'],
  ['Each friend represents a world in us, a world possibly not born until they arrive.', 'Anaïs Nin'],
  ['You yourself, as much as anybody in the entire universe, deserve your love and affection.', 'Sharon Salzberg'],
  ['What would life be if we had no courage to attempt anything?', 'Vincent van Gogh'],
  ['Darkness cannot drive out darkness; only light can do that.', 'Martin Luther King Jr.'],
  ['There are better things ahead than any we leave behind.', 'C. S. Lewis'],
  ['Forever is composed of nows.', 'Emily Dickinson'],
  ['Not knowing when the dawn will come, I open every door.', 'Emily Dickinson'],
  ['For there is always light, if only we’re brave enough to see it. If only we’re brave enough to be it.', 'Amanda Gorman', 'The Hill We Climb'],
  ['Unless someone like you cares a whole awful lot, nothing is going to get better. It’s not.', 'Dr. Seuss', 'The Lorax'],
  ['Within you, there is a stillness and a sanctuary to which you can retreat at any time.', 'Hermann Hesse', 'Siddhartha'],
  ['One kind word can warm three winter months.', 'Japanese proverb'],
  ['Fall seven times, stand up eight.', 'Japanese proverb'],
  ['Rest is not idleness.', 'John Lubbock'],
  ['Courage doesn’t always roar.', 'Mary Anne Radmacher'],
  ['Optimism is the faith that leads to achievement.', 'Helen Keller'],
  ['To love oneself is the beginning of a lifelong romance.', 'Oscar Wilde'],
  ['If you want to go fast, go alone. If you want to go far, go together.', 'Proverb'],
].map(([text, author, source]) => ({ text, author, source: source || null }));

// Word-play tiles. Deliberately only kind or neutral words, with no negations
// ("not", "never", "no") and nothing that could be arranged into a put-down.
export const GLUE_WORDS = [
  'I', 'you', 'we', 'me', 'my', 'your', 'our', 'is', 'am', 'are', 'be', 'the', 'a', 'and', 'so', 'to', 'of',
  'in', 'with', 'for', 'like', 'all', 'still', 'just', 'here', 'today', 'again', 'always', 'more', 'very',
  '-s', '-ing', '-ly', '?', '!',
];

export const CONTENT_WORDS = [
  'hope', 'light', 'sun', 'moon', 'stars', 'sky', 'rain', 'sea', 'morning', 'night', 'dream', 'heart', 'home',
  'friend', 'kind', 'gentle', 'brave', 'soft', 'warm', 'bright', 'quiet', 'calm', 'new', 'wild', 'free', 'golden',
  'blue', 'green', 'together', 'okay', 'enough', 'worth', 'loved', 'love', 'care', 'hold', 'hug', 'smile',
  'laugh', 'sing', 'dance', 'grow', 'bloom', 'rest', 'breathe', 'walk', 'fly', 'find', 'keep', 'try', 'begin',
  'stay', 'listen', 'talk', 'share', 'wonder', 'believe', 'matter', 'shine', 'heal', 'tea', 'coffee', 'music',
  'book', 'song', 'garden', 'flower', 'ocean', 'river', 'mountain', 'window', 'letter', 'path', 'road', 'way',
  'story', 'word', 'chance', 'moment', 'day', 'week', 'year', 'life', 'world', 'someone', 'everyone', 'thank',
  'hello', 'maybe', 'yes', 'soon', 'through', 'because', 'beautiful', 'proud', 'safe', 'strong', 'lucky',
  'alive', 'honest', 'curious', 'grateful', 'peace', 'joy', 'spring', 'summer', 'autumn', 'winter', 'snow',
  'leaf', 'bird', 'honey', 'bread', 'candle', 'blanket', 'cloud', 'wave', 'dawn', 'glow', 'tender', 'slowly',
  'softly', 'welcome', 'tomorrow', 'remember', 'feel', 'better', 'deserve', 'belong', 'okay', 'whole',
];

const ALL_WORDS = new Set([...GLUE_WORDS, ...CONTENT_WORDS].map((w) => w.toLowerCase()));
export const isBankWord = (w) => ALL_WORDS.has(String(w).toLowerCase());

// Deterministic per-day randomness so everyone sees the same quote and tiles.
function seeded(day) {
  let s = [...day].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quoteFor(day) {
  // Walk the list in a fixed shuffled order so consecutive days never feel repetitive.
  const order = [...QUOTES.keys()];
  const rand = seeded('kindboard-quotes');
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  return QUOTES[order[((dayNumber % order.length) + order.length) % order.length]];
}

export function wordsFor(day, count = 40) {
  const rand = seeded(`kindboard-words-${day}`);
  const pool = [...new Set(CONTENT_WORDS)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { words: pool.slice(0, count), glue: GLUE_WORDS };
}

// Hand-drawn doodle stickers (artwork lives in public/doodles.js).
export const DOODLES = ['heart', 'star', 'sparkle', 'sun', 'moon', 'flower', 'leaf', 'cloud', 'cup', 'letter', 'music', 'smile', 'rainbow', 'plant'];

// A few more quotes for waiting screens, in a stable order for the day (today's quote first).
export function quotesFor(day, count = 6) {
  const first = quoteFor(day);
  const rand = seeded(`kindboard-more-${day}`);
  const rest = QUOTES.filter((q) => q !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest.slice(0, count - 1)];
}
