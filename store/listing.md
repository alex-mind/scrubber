# Store listing copy

Paste-ready for both dashboards. Chrome Web Store and Edge Add-ons ask for the same
fields under slightly different names; where they differ it's noted.

---

## Name

```
Scrubber
```

## Short description  (CWS limit 132 · Edge calls it "Short description", limit 132)

125 characters — identical to `manifest.json`'s `description`, which is what both
stores prefill from. Keep the two in sync.

```
Pins YouTube comments to the moment they're about: density marks on the progress bar, and the good ones surface as you watch.
```

## Category

- **Chrome Web Store:** Entertainment  (fallback: Tools)
- **Edge Add-ons:** Entertainment

## Language

English (United States)

---

## Detailed description

```
Viewers have been hand-typing timestamps into YouTube comments for over a decade. "3:42 is the part that finally made it click." "Skip to 12:05." YouTube turns those into links, then buries them under a thousand other comments where nobody scrolling will ever find them at the moment they'd matter.

Scrubber reads those timestamps off the page and puts them back where they belong — on the progress bar.

WHAT YOU SEE

• Density marks over the progress bar. Taller, brighter marks mean more people stopped to say something about that moment. The shape of a video's attention becomes visible before you watch a second of it.

• Hover anywhere on the bar to read the comments about that point.

• As you watch, the best comment about the moment you're in surfaces on its own, then gets out of the way. One per burst, spaced out, and never the same moment twice in a row.

ADD YOUR OWN

The same panel you read from is the one you write from. Reply to a comment, like it, or write your own comment stamped with the moment you're at — it posts to YouTube normally, so it auto-links for everyone, whether or not they have Scrubber.

Nothing is ever posted on your behalf automatically. Every comment, reply and like happens only when you click send, and nothing at all can be posted while you're signed out.

WHY IT'S USEFUL

On tutorials it's a table of contents the creator never wrote — roughly one comment in eight carries a timestamp, and they cluster hard around the parts people got stuck on. On podcasts and long interviews it's a map of the moments worth hearing.

TUNE IT OR TURN IT OFF

A minimum-likes threshold, a cooldown between pop-ups, and how wide a window around the playhead counts as "this moment" — all in the toolbar popup, all changeable mid-video. One switch turns the whole thing off without uninstalling.

ABOUT YOUR DATA — THE SHORT VERSION

Scrubber talks to YouTube exactly the way the YouTube page itself does: same origin, same session already in your browser. There is no server of ours, no third party, and no account. It runs nowhere outside youtube.com and stores nothing but your own settings. No analytics, no tracking, no telemetry of any kind.

The only thing that ever leaves your browser is a comment, reply or like you chose to send — and it goes to YouTube, exactly where it would have gone if you had used YouTube's own comment box. We never see it, because there is no "we" to see it.

The source is public: https://github.com/alex-mind/scrubber

KNOWN LIMITS

Comments come from YouTube's own internal API, which Google changes without notice. Scrubber searches that response by key rather than by a fixed path so it survives most of those changes, but a hard break shows up as an empty bar. The mark count in the popup is the quickest way to tell.

Desktop YouTube only for now.
```

---

## Website / homepage URL

```
https://alex-mind.github.io/scrubber/
```

## Support URL

```
https://github.com/alex-mind/scrubber/issues
```

## Privacy policy URL

```
https://alex-mind.github.io/scrubber/privacy.html
```

---

## Assets

| Asset | File | Spec |
|---|---|---|
| Store icon | `store/icon-128-store.png` | 128×128, 96×96 artwork + 16px transparent padding |
| Small promo tile | `store/promo-440x280.png` | 440×280, full bleed — required for listing placement |
| Screenshots | `store/screenshots/*.png` | 1280×800, 1–5 of them |

The in-manifest `icons/` are deliberately full-bleed and are *not* the listing icon.
Both are regenerated from `art/*.html` via headless Chrome; edit the HTML, not the PNG.
