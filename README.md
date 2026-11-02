# kindboard

**A community board for people, by people.** It's for anyone who wants to talk to someone when nobody is around. You pin a sticky note anonymously, with no word limit, and kind strangers write back.

Every day has its own board. When the day ends, the board is **archived**: anyone can still open and read it, but nobody can edit it.

## The experience

1. **Hello.** A big "hello" types itself out and erases, then retypes in about 50 languages. The browser tab title changes with it. *Click anywhere to begin.*
2. **What this is & why it exists.** Three short cards: write a note, someone writes back, a new page every day.
3. **Kind rules, and what happens if you break them.** Flagged → removed + a strike → 2 strikes and the identity is paused (it can read, not post). Then *"I agree, let me in."*
4. **Log in / sign up.** Pick an anonymous animal ("Anonymous Otter"), choose a passphrase, and you get a handle like `otter-2841`.
5. **Waiting moments.** Any time something loads, a calm screen shows a quote just below the loader. Quotes are curated and credited, and they rotate daily.
6. **Calendar.** A "level map" of the month: days snake along a dotted trail, with visited days colored by their notes and a "You are here" marker on today. A classic grid is one tap away. Hover a day to preview it.
7. **The board.** Notes in soft paper colors. Click a note to open its conversation, where each reply shows the writer's animal. You can decorate with:
   - **Word play:** a fresh set of jumbled word tiles every day. Tap words to build sentences next to notes. Only kind words are in the bank, and no negations, so tiles can't be arranged into put-downs. You can add your own word, which is checked first.
   - **Stickers:** original hand-drawn doodles, die-cut style.
   - **Made by me:** draw your own sticker, or turn a photo into one.

## Safety & security

| | |
|---|---|
| Anonymous | No email, phone or name. An identity is an animal + a 4-digit handle. |
| Passphrases | At least 10 characters, common ones rejected, hashed with **scrypt** (random salt per user). They can't be recovered, by design. |
| Sessions | Random token in an **HttpOnly, SameSite=Strict** cookie (`Secure` over HTTPS). "Log out on all devices" is supported. |
| Brute force | Per-IP rate limits, plus a **15-minute lockout per handle** after 8 failed attempts. Unknown handles get the same generic error and take the same time. |
| CSRF / XSS | A custom request header and Origin check, a strict Content-Security-Policy, and user content rendered only as text. |
| Kindness filter | Slurs, threats, "kys" and belittling insults are blocked before posting, even with leetspeak or s.p.a.c.i.n.g. Venting about yourself is allowed. |
| Automatic moderation | Clearly harmful posts are refused and count as a **strike** automatically. **2 strikes → paused**: their posts are removed, and new sign-ups from that network pause for 7 days. Put-downs are refused with a prompt to rephrase (no strike). |
| Waiting for approval | Links, contact details, "DM me on…" and hand-made stickers go up as **waiting for approval**. Only the writer sees them until a moderator approves them on `/admin`. |
| Reports | A quiet "Report" in each ⋯ menu. Reports never give strikes; 3 of them send a post back for a moderator to review. |
| Local weather (optional) | The intro sky follows each visitor's own clock. Real weather is opt-in: the browser asks for location, it's rounded to about 10 km, kept only in that browser, and sent only to Open-Meteo (free, no key). Our server never sees it. |
| Support | Notes that sound like someone is struggling still post, and the writer is shown crisis lines (988, Samaritans, findahelpline.com). |
| Moderators | `/admin` with your `ADMIN_KEY`: approve or decline waiting posts, keep or remove reported ones (removing adds a strike), restore mistakes. Check it regularly so nobody waits long. |

## Run it

Requires **Node 22.13+**. Zero dependencies, using built-in SQLite.

```bash
ADMIN_KEY=choose-a-secret IP_SALT=another-random-secret npm start
```

Open http://localhost:3000. Run the moderation tests with `npm test`.

## Put it online (a public link + your own domain)

It's one Node process plus one SQLite file.

**Render.com**
1. Push this folder to a GitHub repo.
2. **New → Web Service** from that repo, with start command `npm start`.
3. Add a **Disk** mounted at `/data`. Set `DB_PATH=/data/kindboard.db`, `ADMIN_KEY`, `IP_SALT`, `TRUST_PROXY=1`.
4. Under **Settings → Custom Domains**, add your domain.

**Fly.io / Railway / a VPS**: use the `Dockerfile`, with a volume at `/data`.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | |
| `DB_PATH` | `./kindboard.db` | Put it on a persistent disk. |
| `ADMIN_KEY` | *(off)* | Password for `/admin`. |
| `IP_SALT` | none | Secret for hashing IPs. Raw IPs are never stored. |
| `BOARD_TZ` | `UTC` | When "today" rolls over, e.g. `America/New_York`. |
| `TRUST_PROXY` | off | `1` behind Render/Fly/Nginx. |
| `COOKIE_SECURE` | auto | Force `1`/`0` if auto-detection is wrong for your host. |
| `FLAGS_TO_HIDE` | `3` | Distinct reports that send a post back to review. |

## Continue with Google (optional)

People can sign in with Google instead of a password. Kindboard asks Google only for the `openid` scope, so it learns nothing but an anonymous account id, and stores only a salted hash of that. No name, email or photo, ever.

1. Go to **console.cloud.google.com**, create a project, then **APIs & Services → OAuth consent screen**. Choose *External*, add the app name, your support email, and publish it.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*.
   - Authorised redirect URI: `https://YOUR-SITE/auth/google/callback` (e.g. `https://kind-board.onrender.com/auth/google/callback`)
3. Copy the client ID and secret into Render's environment variables:

| Env var | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 2 |
| `GOOGLE_CLIENT_SECRET` | from step 2 |
| `PUBLIC_URL` | your site's address, e.g. `https://kind-board.onrender.com` |
| `ACCOUNT_SALT` | a long random secret. **Never change it** once people have signed in, or they lose their way back. |

The "Continue with Google" button appears automatically once these are set.

## Before sharing publicly

- **Keep data between restarts.** Render's free plan wipes everything on each restart. Use a paid instance with a disk mounted at `/data` and `DB_PATH=/data/kindboard.db`.
- **Set strong secrets.** Long random `ADMIN_KEY`, `IP_SALT` and `ACCOUNT_SALT`.
- **Watch `/admin`.** Approve waiting posts so nobody waits long, especially in the first days.

## Known limits

- The word filter is a strong first line, not a perfect one. Extend `moderation.js`, or add an AI moderation service for nuance. Drawn stickers rely on flags.
- The network pause can catch others on shared Wi-Fi, so it expires after 7 days.
- Rate limits live in memory, so run a single instance.

## Files

```
server.js        HTTP server, API, auth, SQLite, live updates, strikes
moderation.js    kindness filter for notes and word tiles (+ test/)
content.js       daily quotes, word-tile bank, doodle names
public/          index.html, app.js, styles.css, doodles.js, admin page
```
