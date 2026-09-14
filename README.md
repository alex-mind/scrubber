
[![VIBE CODED](https://img.shields.io/badge/VIBE-CODED-ff6f9c?style=for-the-badge&labelColor=17181c)](https://github.com/alex-mind/scrubber)

# Scrubber

<img src="art/slop-sign.png" width="118" align="left" hspace="18" vspace="4" alt="SLOP">


Comments pinned to the moment they're about.

YouTube viewers have been hand-typing timestamps into comments for over a decade, and
YouTube auto-links them. Scrubber reads those timestamps off the page, draws them as
density marks over the progress bar, and surfaces the good ones as you watch.

![Scrubber on a video: density marks across the progress bar, and the comments about
the moment under the cursor](store/screenshots/01-hover-window.png)

*Hovering the bar at 3:09. The marks are other people's timestamps; the panel is what
they said about that moment.*

**[alex-mind.github.io/scrubber](https://alex-mind.github.io/scrubber/)** — install page,
and a live demo you can scrub without installing anything.

## What it does

- **Density marks over the progress bar.** Taller, brighter marks mean more people
  stopped to say something there. You can read a video's shape before watching it.
- **Hover to read.** Point anywhere on the bar for the comments about that moment.
- **Comments surface as you watch.** The best-liked one for the moment you're in
  appears, then gets out of the way — one per burst, spaced out, and the same point
  always surfaces the same comment, so rewinding works.
- **Add your own.** Reply, like, or post a comment stamped with the current moment. It
  goes through YouTube normally, so the timestamp auto-links for everyone.
- **Tune it.** Minimum likes, cooldown between pop-ups, and how wide a window counts as
  "this moment" — all in the toolbar popup, changeable mid-video.

On tutorials roughly one comment in eight carries a timestamp, and they cluster hard on
the parts people got stuck at — a contents page the creator never wrote.

## Install

### Chrome, Edge, Brave, Arc, Opera

The store listing is in review. Until it lands, grab the zip from
[the latest release](https://github.com/alex-mind/scrubber/releases/latest) and unzip
it, or build it yourself:

```sh
./build.sh chrome     # -> build/extension/ and dist/scrubber-<version>.zip
```

Then:

1. Open `chrome://extensions` and turn on **Developer mode**
2. **Load unpacked** → pick **`build/extension`**, not the repo root
3. Open any YouTube video — marks appear once the comments load

Reading works signed out; posting, replying and liking need you signed into YouTube.

### Safari

Safari has no "load unpacked" — every extension ships inside a native app, so this one
has to be built. Needs macOS with **Xcode** installed, not just the Command Line Tools.

```sh
./build.sh safari-app     # convert, build, install to /Applications, register
```

Then:

1. **Safari → Settings → Extensions** and tick **Scrubber**
2. Set youtube.com to **Allow on Every Website**, or at least **Always Allow on This
   Website** — without this the extension never runs
3. Open any YouTube video

If it doesn't show up in the list, **quit Safari completely and reopen it** — Safari
reads its extension list once per launch. Without a paid Apple developer account the
build is unsigned, and Safari then needs **Develop → Allow unsigned extensions** ticked
again after every restart.

Confirm what is registered with:

```sh
pluginkit -mAv | grep -i scrubber     # the path must be /Applications, not DerivedData
```

Shipping Safari on a store needs a $99/yr Apple developer account, which is why it
isn't on one. Building it locally is free. Failure modes and fixes:
[notes/safari.md](notes/safari.md).

### Support

| | Chrome / Edge / Brave / Arc / Opera | Safari macOS | Safari iOS |
|---|---|---|---|
| Desktop YouTube | yes | build it yourself | — |
| Mobile web YouTube | — | — | build it yourself |

## Your data

There is no server, no account, and no third party. Scrubber talks to youtube.com the
same way the YouTube page does, on the same origin, with the session already in your
browser. It stores nothing but your own settings, and the only thing that ever leaves
your browser is a comment you typed and pressed send on.

Full text: [privacy policy](https://alex-mind.github.io/scrubber/privacy.html).

## Working on it

- [CLAUDE.md](CLAUDE.md) — orientation, commands, and the invariants not to break
- [notes/architecture.md](notes/architecture.md) — how the pieces fit, known gaps
- [notes/design-decisions.md](notes/design-decisions.md) — why the code is shaped this
  way. Most entries record a bug that the obvious implementation caused; read before
  editing.
- [notes/safari.md](notes/safari.md) — the Safari build and its silent failure modes
- [store/](store/) — everything submitted to the Chrome Web Store

MIT licensed.
