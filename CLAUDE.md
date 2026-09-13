# CLAUDE.md

Browser extension that reads the timestamps people type into YouTube comments and
draws them as density marks over the player's progress bar. Vanilla JS, MV3, no build
step, no bundler, no dependencies. Chrome/Edge ship from the store; Safari is
build-it-yourself.

## Commands

```sh
./build.sh chrome          # stage to build/extension/ + zip to dist/scrubber-<version>.zip
./build.sh stage           # stage only
./build.sh safari-app      # convert, build, install to /Applications, register
```

There are no tests and no linter. Verification is manual: load `build/extension`
unpacked at `chrome://extensions`, open a video, confirm marks render and the popup's
mark count is non-zero. **Load `build/extension`, never the repo root** — the root also
holds `docs/`, `store/`, `art/` and `notes/`.

## Map

| Path | What |
|---|---|
| `manifest.json` | MV3. One permission (`storage`), no host permissions. |
| `src/compat.js` | `browser`/`chrome` namespace shim, promise-only |
| `src/adapters.js` | desktop + mobile DOM adapters — all platform specifics live here |
| `src/innertube.js` | YouTube's own comment endpoint: read and write |
| `src/content.js` | parsing, density, pop-out, scheduling |
| `src/content.css` | overlay styling + mobile overrides |
| `src/popup.*` | settings |
| `build.sh` | store zip; Safari convert/repair/build/install |
| `docs/` | the install site, served by GitHub Pages from this folder |
| `store/` | listing copy, permission answers, generated icon/promo/screenshots |
| `art/` | HTML sources for every generated image |
| `notes/` | architecture, design decisions, Safari |

## Invariants — do not break these

1. **Every write fires only from an explicit user click.** `create()`, `reply()` and
   `like()` in `src/innertube.js` post as the signed-in user. Never call one on a timer,
   on page load, during playback, or as a side effect. This exact claim is certified to
   Google in `store/permissions.md`; breaking it makes that certification false.
2. **No `innerHTML`.** YouTube enforces Trusted Types on this origin and it throws.
   Build DOM with `createElement` / `textContent`.
3. **No remote code.** No `eval`, no `new Function`, no injected `<script>`. MV3 policy,
   and it is certified in the listing.
4. **No backend, ever.** `ORIGIN` is `location.origin` and there is exactly one
   `fetch()` in the extension. "There is no server of ours" appears in the privacy
   policy — adding one would make the published policy a lie.
5. **`contentDuration()` returning 0 during ads is deliberate.** Ads reuse the same
   `<video>`; reading `duration` then discards every mark. Do not "fix" it.
6. **Don't hand-edit PNGs** in `store/` or `art/`. Regenerate from `art/*.html`:
   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
     --screenshot=out.png --window-size=440,280 file://$PWD/art/promo-440x280.html
   ```

## Store constraints

- `manifest.json` `description` must stay **≤132 characters** and match the short
  description in `store/listing.md`. The store rejects longer.
- Version numbers are **one-way once published**. A draft can be re-uploaded at the
  same version; a published item needs a bump.
- Anything that changes what the extension *does* — especially the write paths — must
  be mirrored into `store/permissions.md`, `store/listing.md`,
  `store/data-disclosure.md` and `docs/privacy.html` in the same change. Undisclosed
  posting on a user's behalf is a takedown reason.

## Conventions

- Comments explain **why**, not what — usually the failure that motivated the code.
  Match that register; `notes/design-decisions.md` is the long form.
- Plain ES, no frameworks, no transpilation. Whatever ships is what is readable.
- `docs/` is a real website. It must stay theme-aware and readable at 400px wide.

## Further reading

- `notes/architecture.md` — how the pieces fit, measured results, known gaps
- `notes/design-decisions.md` — why the code is shaped this way. Read before editing.
- `notes/safari.md` — the Safari build and its silent failure modes
- `store/` — everything submitted to the Chrome Web Store
