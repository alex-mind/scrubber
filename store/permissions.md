# Privacy practices tab — the fields review actually grades

Chrome Web Store makes every one of these a required free-text field and rejects
submissions whose justification doesn't match what the code does. Edge Add-ons asks
the same questions in its "Availability"/"Properties" steps.

Everything below is verifiable against the source in a couple of minutes, which is
the point — a reviewer who checks should find exactly this.

---

## Single purpose description

```
Scrubber has one purpose: to surface the YouTube comments that contain a timestamp at the point in the video those timestamps refer to. It draws them as density marks over the player's progress bar and shows the relevant comment as playback reaches that moment. It does nothing else and runs nowhere else.
```

## Permission justification — `storage`

```
Stores the user's own settings, and nothing else: whether the extension is enabled, whether pop-ups are shown, the minimum-likes threshold, the cooldown between pop-ups, and the window in seconds around the playhead. These are written only when the user changes a control in the toolbar popup, and are read back on each page load so the settings persist. No comment data, no browsing history, and no identifiers are stored. storage.sync is used when available so settings follow the user's Chrome profile, falling back to storage.local otherwise (src/compat.js).
```

## Host permission justification

```
The extension declares no host permissions. Its content script is scoped by the manifest to youtube.com only, and it is the sole way the extension touches any page. It reads the comment data the YouTube page has already loaded and draws an overlay on the player's progress bar. It does not run on any other site.
```

## Remote code

```
No. All logic ships inside the package. There is no eval(), no new Function(), no remotely hosted script, and no code fetched or injected at runtime.
```

Verifiable: `grep -rn "eval(\|new Function\|createElement('script')" src/` returns nothing.

---

## The question a reviewer will actually stop on

The single network request in the extension (`src/innertube.js:62`) is a POST to
`https://www.youtube.com/youtubei/v1/next` — YouTube's own internal comment endpoint.
Expect this to draw attention, and answer it before it's asked:

```
The extension makes one kind of network request: to youtube.com's own internal comment endpoint, from the content script, on the youtube.com origin, using the session the user is already signed into — the same request the YouTube page makes for itself when you scroll to the comments. It is a same-origin request to the site the user is already on. No request is made to any server operated by the developer or by any third party; there is no such server. The response is parsed for timestamps in memory and is never stored or transmitted anywhere.
```

## Why this is not "collecting user data"

Nothing leaves the user's browser, nothing is persisted but their own settings, and
there is no backend to receive anything. Answer the data-usage form accordingly —
see `data-disclosure.md`.
