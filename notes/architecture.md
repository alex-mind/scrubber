# Architecture

What the pieces are, how they fit, and the rules that must not be broken.

## Files

```
manifest.json       MV3, matches www.youtube.com + m.youtube.com
src/compat.js       browser/chrome namespace shim; promise-only, no callbacks
src/adapters.js     desktop + mobile DOM adapters — all platform specifics live here
src/innertube.js    YouTube's own comment endpoint; parses both comment shapes
src/content.js      parsing, density, pop-out — platform-agnostic
src/content.css     liquid-glass material + mobile overrides
src/popup.html/js   settings
build.sh            store zip; Safari convert/repair/build/install
docs/               the install site, served by GitHub Pages from this folder
store/              listing copy, permission answers, icon/promo/screenshots
art/                HTML sources for the generated images — edit these, not the PNGs
```

Every image in `store/` and the SLOP sign are rendered from `art/*.html` with headless
Chrome, so there is no binary to hand-edit and no image tooling to install:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --screenshot=out.png --window-size=440,280 file://$PWD/art/promo-440x280.html
```

`compat.js` picks `browser` if present (Safari, Firefox) and `chrome` otherwise, then
only ever calls the promise form — which Chrome MV3 also returns as long as you don't
pass a callback. `storage.sync` falls back to `storage.local` where sync is missing or
policy-disabled.

## Reading and writing

Phase 2 — your own marks — is in. Scrubber can do three things as the signed-in user,
all through YouTube's own endpoints on youtube.com:

| | Source |
|---|---|
| Post a comment stamped with the current moment | `create()` in `src/innertube.js` |
| Reply to a comment | `reply()` |
| Like a comment | `like()` |

It posts through YouTube normally, so the timestamp auto-links for everyone whether or
not they have Scrubber. There is still no backend — `ORIGIN` is `location.origin`, and
there is exactly one `fetch()` in the extension.

**The invariant that matters:** every write fires only from an explicit click on a send
or like button. Never on a timer, never on page load, never during playback, never as a
side effect of anything else, and never at all while signed out — each write path
returns `not signed in` without an auth header. Keep it that way; it is the whole
answer to the only hard question a store reviewer asks, and `store/permissions.md` is
written on the assumption that it holds.

## What it measured on real pages

First 220 comments, 12 Sep 2026:

| Video | Comments with a timestamp | Marks |
|---|---|---|
| React full course (tutorial) | 11.8% | 103 |
| Lex Fridman #438 (podcast) | 4.1% | 9 |

Every hit came from YouTube's own timestamp anchors; the plain-text regex fallback
added almost nothing. Tutorials are roughly 3x denser than podcasts, which is why
they're the beachhead.

## Known gaps

- The mobile **pop-out and density render** were verified by injection against the live
  m.youtube.com DOM, but the extension has not been run end-to-end inside iOS Safari —
  that needs Xcode and a device, which is on you.
- The comment fetch depends on **undocumented InnerTube shapes** that Google changes
  without notice. `extract()` searches by key rather than by path to survive most of
  that, and the scroll walk is still there as a fallback, but a hard break shows up as
  an empty bar on a fresh page. The popup's mark count is the quickest way to tell.
- Mobile web only matters for people who watch YouTube in Safari rather than the
  YouTube app. An extension cannot touch the native app, so iOS reach is inherently
  much smaller than the effort suggests.

## Not built yet

One-keypress emoji marks, which is where density actually comes from.
