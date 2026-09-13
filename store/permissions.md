# Privacy practices tab — the fields review actually grades

Chrome Web Store makes every one of these a required free-text field and rejects
submissions whose justification doesn't match what the code does. Edge Add-ons asks
the same questions in its "Availability"/"Properties" steps.

Everything below is verifiable against the source in a couple of minutes, which is
the point — a reviewer who checks should find exactly this.

> **This extension both reads and writes.** It surfaces existing timestamped comments,
> and it can post a comment, post a reply, and like a comment as the signed-in user.
> Say so plainly everywhere. An extension that writes on a user's behalf and doesn't
> disclose it is the fastest way to get pulled after approval.

---

## Single purpose description

```
Scrubber makes YouTube comments time-aware. It reads the timestamps people type into comments and surfaces those comments at the moment of the video they refer to — as density marks over the progress bar, and as a card when playback reaches that moment. From the same surface you can reply to one of those comments, like it, or write your own comment stamped with the current moment. Reading and writing are two halves of one purpose: tying comments to points in the video. The extension does nothing else and runs nowhere else.
```

## Permission justification — `storage`

```
Stores the user's own settings, and nothing else: whether the extension is enabled, whether bars and pop-ups are shown, the minimum-likes threshold, the cooldown between pop-ups, how long a card stays up, and the window in seconds around the playhead. These are written only when the user changes a control in the toolbar popup, and are read back on each page load so the settings persist. No comment data, no browsing history, and no identifiers are stored. storage.sync is used when available so settings follow the user's Chrome profile, falling back to storage.local otherwise (src/compat.js).
```

## Host permission justification

```
The extension declares no host permissions. Its content script is scoped by the manifest to youtube.com only, and it is the sole way the extension touches any page. It reads the comment data the YouTube page loads, draws an overlay on the player's progress bar, and — only when the user clicks a send or like button — sends that action to YouTube on the same origin. It does not run on any other site.
```

## Remote code

```
No. All logic ships inside the package. There is no eval(), no new Function(), no remotely hosted script, and no code fetched or injected at runtime.
```

Verifiable: `grep -rn "eval(\|new Function\|createElement('script')" src/` returns nothing.

---

## The two questions a reviewer will actually stop on

### 1. "It calls an internal YouTube API"

```
The extension talks to one host: youtube.com, from a content script running on youtube.com, using the session the user is already signed into. It calls youtube.com's own internal endpoints — the same ones the YouTube page itself calls: /youtubei/v1/next to load comments, and /youtubei/v1/comment/create_comment when the user posts one. These are same-origin requests to the site the user is already on. No request is made to any server operated by the developer or by any third party; there is no such server. In the source, ORIGIN is literally location.origin (src/innertube.js:13) and there is exactly one fetch() call in the entire extension (src/innertube.js:62).
```

### 2. "It can post as the user"

This is the one that matters. Answer it without hedging:

```
Yes, and only ever from an explicit click. The extension can do three things as the signed-in user: post a top-level comment stamped with the current moment, post a reply to a comment, and like a comment. Each is triggered exclusively by the user clicking a send or like button in the extension's own UI. None of them runs on a timer, on page load, on playback, or as a side effect of any other action, and none can fire while signed out — every write path returns early with "not signed in" if there is no auth header (src/innertube.js). Nothing is ever posted without the user typing it and pressing send. The extension never edits or deletes anything, and never posts to any destination other than the video the user is watching.
```

Point a reviewer at `create()`, `reply()` and `like()` in `src/innertube.js` — each carries a comment stating the click-only rule, and each call site in `src/content.js` is a click handler.

## Why this is still not "collecting user data"

Nothing is transmitted to the developer, because there is no developer server. The only
data that leaves the browser is a comment the user deliberately wrote and pressed send
on, and it goes to YouTube — the same place it would go if they had typed it into
YouTube's own comment box. Nothing is persisted but the user's own settings. Answer the
data-usage form accordingly — see `data-disclosure.md`.
