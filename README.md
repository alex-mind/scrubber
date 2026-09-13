# Scrubber

# 🛑 SLOP 🛑

[![VIBE CODED](https://img.shields.io/badge/VIBE-CODED-ff6f9c?style=for-the-badge&labelColor=17181c)](https://github.com/alex-mind/scrubber)
[![MV3](https://img.shields.io/badge/manifest-v3-d61f58?style=for-the-badge&labelColor=17181c)](manifest.json)
[![no telemetry](https://img.shields.io/badge/telemetry-none-3a3c44?style=for-the-badge&labelColor=17181c)](https://alex-mind.github.io/scrubber/privacy.html)

Comments pinned to the moment they're about.

YouTube viewers have been hand-typing timestamps into comments for over a decade,
and YouTube auto-links them. Scrubber reads those timestamps off the page, draws
them as density marks over the progress bar, and surfaces good ones as you watch.

Talks to YouTube **exactly the way the page itself does** — same origin, same session
already in your browser, no third party and no server of ours. Reads comments that way,
and posts your own the same way, only ever from an explicit click. Stores nothing but
your own settings.

| | Chrome / Edge / Brave | Safari macOS | Safari iOS / iPadOS |
|---|---|---|---|
| Desktop YouTube | yes | yes | — |
| Mobile web YouTube | — | — | yes |

## Install — Chrome

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → pick this folder
3. Open a video — comments are fetched automatically

`./build.sh chrome` produces `dist/scrubber-chrome.zip` for upload.

## Install — Safari

Safari has no "load unpacked". Every extension ships inside a native app, so the
source is converted into an Xcode project. Needs macOS with Xcode (not just the
Command Line Tools).

```sh
./build.sh safari-app    # convert, repair, build, install to /Applications, launch
```

That leaves `Scrubber.app` in `/Applications` with the extension registered. Confirm
with:

```sh
pluginkit -m -v -p com.apple.Safari.web-extension | grep -i scrubber
```

Then, in Safari:

1. **Settings → Extensions →** tick **Scrubber**
2. Set youtube.com to *Allow on Every Website*, or at least *Always Allow on This
   Website* — without this the content script never runs
3. Open a video — comments are fetched automatically

If the extension doesn't appear, **quit Safari and reopen it** — Safari caches the
extension list and will not show a build it rejected earlier in the session.

`./build.sh safari` stops after generating the project if you'd rather open
`../scrubber-safari/Scrubber/Scrubber.xcodeproj` and hit Run yourself.

### If the extension disappears from Safari

The usual cause is not signing, and not Safari's cache. `xcodebuild` registers the
appex **it just built** — the one under `build/DerivedData` — with `pluginkit`. Copying
the app to `/Applications` afterwards does not move that registration, and `pluginkit`
keeps only one record per bundle identifier. So Safari loads the extension out of a
build directory, and the next time that directory is cleaned or rebuilt the record
dangles and the extension vanishes from Safari's list with no error.

`build.sh safari-app` now re-points it after installing:

```sh
pluginkit -r "<DerivedData>/Scrubber.app/Contents/PlugIns/Scrubber Extension.appex"
pluginkit -a "/Applications/Scrubber.app/Contents/PlugIns/Scrubber Extension.appex"
```

Check which copy is live with:

```sh
pluginkit -mAv | grep -i scrubber     # the path on the right must be /Applications
```

Then **fully quit Safari and reopen it** — it reads the extension list once per launch.

Do not run `lsregister -f` on the app to try to fix this; it clears the registration
rather than refreshing it.

### What the converter gets wrong

`safari-web-extension-converter` exits 0 and prints no warning in both of these
cases. `build.sh` repairs them after every conversion; worth knowing about because
the symptom in each case is an extension that installs fine and does nothing.

**It does not copy the extension payload into the project.** It adds `manifest.json`,
`src` and `icons` to the appex's Resources build phase as file references pointing
back at whatever folder you handed it — here `build/extension`, which the next
`./build.sh stage` deletes. `Scrubber Extension/` has no `Resources` directory at
all, which looks identical to a permissions problem. `selfcontain()` copies the
payload in and rewrites those references to `Resources/...`.

(Related, and still true: **`--project-location` must sit outside the folder being
converted** — the converter reads the entire folder it is given, so a nested output
directory feeds the previous build back into the next one.)

**It derives the two bundle identifiers from different inputs.** The app gets
`<prefix>.<AppName>` from `--app-name` and the appex gets
`<--bundle-identifier>.Extension`, so `--app-name Scrubber` plus
`--bundle-identifier dev.myndar.scrubber` yields `dev.myndar.Scrubber` and
`dev.myndar.scrubber.Extension`. The case differs, the appex id is therefore not
prefixed by the app id, and the build fails at `ValidateEmbeddedBinary`:

```
error: Embedded binary's bundle identifier is not prefixed with the parent app's
bundle identifier.
```

`fixbundleids()` pins both to `dev.myndar.scrubber`. The lowercase form is the one
to keep — `Scrubber/ViewController.swift` hardcodes
`dev.myndar.scrubber.Extension`.

### Signing

**Safari silently hides extensions it considers unsigned.** Not greyed out, not an
error — the extension is simply absent from Settings → Extensions, which is
indistinguishable from it never having installed. `pluginkit` still lists it as
registered, so that is not a useful check:

```sh
pluginkit -mAvvv -i dev.myndar.scrubber.Extension   # registered != visible to Safari
codesign -dv --verbose=2 /Applications/Scrubber.app # this is the one that matters
```

A properly signed build shows a chain to Apple Root CA and a real team:

```
Authority=Apple Development: you@example.com (4JGWT8JYZ5)
Authority=Apple Worldwide Developer Relations Certification Authority
Authority=Apple Root CA
TeamIdentifier=VG63W9PSGL
```

`Signature=adhoc` / `TeamIdentifier=not set` is the hidden case.

So `build.sh safari-app` signs properly whenever it can. It reads the team out of
Xcode's prefs and builds with `-allowProvisioningUpdates`, which mints the
certificate on first use — signing into an Apple ID under **Xcode → Settings →
Accounts** is the only manual step, and a free account is enough. Override the team
with `DEV_TEAM=XXXXXXXXXX ./build.sh safari-app`.

With no Apple ID it falls back to ad-hoc and says so. That build works, but only
with **Settings → Advanced → *Show features for web developers***, then **Develop →
Developer Settings → *Allow unsigned extensions***, which **resets every time Safari
restarts**.

A free personal team's certificate expires every 7 days — when Safari drops the
extension, re-run `./build.sh safari-app`. A paid account ($99/year) does not
expire.

### If xcrun can't find the converter

```
xcrun: error: unable to find utility "safari-web-extension-converter"
```

`safari-web-extension-converter` ships inside **Xcode.app** only — the standalone
Command Line Tools don't include it, which is why `xcrun` itself still works.

```sh
xcode-select -p     # /Library/Developer/CommandLineTools means Xcode isn't selected
```

Install Xcode from the Mac App Store, then point the toolchain at it:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcrun --find safari-web-extension-converter   # should print a path
```

### If the converter fails loading a plug-in

```
A required plugin failed to load ... IDESimulatorFoundation
Library not loaded: /Library/Developer/PrivateFrameworks/CoreSimulator.framework/...
```

Xcode is installed but its first-launch components were never laid down — the
simulator frameworks live outside the app bundle, in `/Library/Developer`.

```sh
sudo xcodebuild -runFirstLaunch                     # installs the missing components
xcodebuild -downloadPlatform iOS                    # iOS simulator runtime (Xcode 15+)
ls /Library/Developer/PrivateFrameworks/CoreSimulator.framework   # should now exist
```

The converter only loads the simulator plug-in because it generates an iOS target.
Passing `--macos-only` sidesteps this entirely and needs no platform download — useful
to get a working macOS build first and regenerate with iOS later.

The converter generates both a macOS and an iOS target by default. For iOS you run
the iOS scheme on a simulator or a device, then enable the extension in
**Settings → Apps → Safari → Extensions**.

**Distribution is the real cost.** Safari extensions can only be shipped through the
App Store, which means an Apple Developer account at $99/year plus review. Chrome's
is a one-off $5. Worth knowing before you spend a weekend on the Safari build.

## Layout

```
manifest.json       MV3, matches www.youtube.com + m.youtube.com
src/compat.js       browser/chrome namespace shim; promise-only, no callbacks
src/adapters.js     desktop + mobile DOM adapters — all platform specifics live here
src/innertube.js    YouTube's own comment endpoint; parses both comment shapes
src/content.js      parsing, density, pop-out — platform-agnostic
src/content.css     liquid-glass material + mobile overrides
src/popup.html/js   settings
build.sh            chrome zip; Safari convert/repair/build/install
```

`compat.js` picks `browser` if present (Safari, Firefox) and `chrome` otherwise, then
only ever calls the promise form — which Chrome MV3 also returns as long as you don't
pass a callback. `storage.sync` falls back to `storage.local` where sync is missing or
policy-disabled.

## What it measured on real pages

First 220 comments, 12 Sep 2026:

| Video | Comments with a timestamp | Marks |
|---|---|---|
| React full course (tutorial) | 11.8% | 103 |
| Lex Fridman #438 (podcast) | 4.1% | 9 |

Every hit came from YouTube's own timestamp anchors; the plain-text regex fallback
added almost nothing. Tutorials are roughly 3x denser than podcasts, which is why
they're the beachhead.

## Design notes

- **Ads reuse the same `<video>` element.** Reading `duration` during a pre-roll gives
  the ad's duration and silently discards every mark. `contentDuration()` returns 0
  while an ad is showing, and marks are range-filtered at render time, not parse time.
- **YouTube enforces Trusted Types.** `innerHTML` throws on this origin. Everything is
  built with `createElement` / `textContent`.
- **Mobile class names are obfuscated and rotate.** The mobile progress bar is found by
  probing for shape — wide, short, near the bottom of the player — rather than trusting
  one class. Verified resolving `.ytChapteredProgressBarHost` (544x3 in a 604x340 player)
  on m.youtube.com. If nothing matches, a fallback strip is pinned to the player bottom
  so marks still render.
- **The overlay is absolutely positioned**, so its host must not be `position: static`.
  The probe walks up to the nearest positioned ancestor inside the player.
- **Comments listing many timestamps are indexes, not reactions.** Over 8 stamps is
  dropped; over 1 still counts toward density but never pops out. Mobile comment
  sections are full of "Day 1: 39:36 / Day 2: 1:25:00" study logs that read terribly
  as a card over the video.
- **Which comment appears has to be a function of the video clock.** It used to depend
  on frame timing — which marks happened to fall between two `timeupdate` ticks — and on
  a cooldown measured in wall-clock seconds, while a `fired` set burned every candidate
  it skipped without showing it. So the same second of video produced a different
  comment each time you passed it, and rewinding showed nothing. `buildSchedule()`
  instead groups eligible marks into bursts (anything within the hover window), takes
  the best-liked few from each, and spaces the bursts by the cooldown in *video*
  seconds. The result is cached and rebuilt only when marks or settings change, so
  rewinding to a point always surfaces what that point surfaced before.
- **A likes threshold is a silent filter.** `minLikes` defaulted to 5, which on an
  ordinary video hides most comments — and the hover panel has no such filter, so you
  could read a comment in the window, wait for the card, and never get one. It defaults
  to 0 now, and the panel dims the timestamp of any comment that is *not* in the
  schedule, so the difference is visible instead of something you discover by waiting.
- **The cooldown spaces bursts, not cards.** Comments about one moment are a reaction to
  that moment, so they stack together rather than queueing 30s apart; `MAX_CARDS` caps
  how many. Without this, "two comments here" could never be shown at once.
- **A card you are reading must not expire under you.** Hovering one pauses both its
  timer and the countdown bar (a paused CSS animation); leaving gives it 3s rather than
  the full duration back. Each card carries a close button, and re-crossing a mark whose
  card is still on screen re-arms it instead of stacking a duplicate.
- **The hovered mark is found from the cursor's time, not the event target.** A bucket
  is only a few pixels wide, and giving the overlay pointer events would put it between
  the viewer and YouTube's own scrubbing. The same pass draws the window the hover
  gathers from — a measuring bracket under the marks, run a few px proud of the span so
  its end caps sit outside them rather than on top.
- **Centred above the cursor is already taken.** That is exactly where YouTube puts its
  time bubble, so the hovered mark's count collided with it. The count sits beside the
  mark instead, flipping to the other side near the end of the bar rather than running
  off it.
- **Identical cards, three at a time, meant three scripts.** Each instance keeps its
  own state but they all find the same stack element by selector, so every card was
  drawn once per copy and each copy's dedupe only ever saw its own. A marker on
  `documentElement` lets the first one run and turns the rest into no-ops; cards also
  carry a key and refuse to draw over one already on screen.
- **The panel was sizing itself to the fine-scrubbing strip.** That strip is nearly as
  wide as the player, so the panel stretched across the screen when a drag began.
  `previewBox()` now only accepts the storyboard frame: narrower than half the player
  as well as shorter.
- **Holding the button captures the pointer**, so mousemove targets stop being the bar
  and the panel dropped mid-drag. A drag that started on the bar keeps steering it.
- **The window moves even when its contents do not.** The panel's range is rewritten on
  every move rather than only when the set of comments in it changes.
- **The preview cannot be hovered, so it was never the event target.**
  `.ytp-tooltip` is `pointer-events: none` — `elementFromPoint` at its centre returns
  the `<video>` behind it. Every check of the form "is the pointer on the preview"
  written against `relatedTarget` or `contains()` was therefore dead code, which is why
  two attempts at keeping it alive changed nothing. Position is the only signal that
  works, and with it the leave is withheld and the preview stays (measured: ten leave
  events swallowed, preview alive throughout). YouTube ignores untrusted events, so it
  cannot be dismissed afterwards either — its own state still believes the pointer is on
  the bar — so the release masks it with a class instead, cleared on the next real hover.
- **A day-old copy of a video's comments is still a good copy.** Every accepted comment
  is kept in the shape the cache stores, so writing it back costs nothing. A cold video
  spends eight requests (one lookup, seven pages); a warm one spends three (one lookup,
  two pages) and has its marks on the bar before the first of them returns. Entries expire
  after 24 hours, forty videos are kept, four hundred comments each. The cache goes in
  `storage.local` explicitly — settings live in `sync`, whose quota is far too small for
  this.
- **Bar height is about likes, not just count.** A bucket's weight is the sum of
  `sqrt(likes + 1)` across its comments, so a stretch with several well-liked comments
  out-ranks one runaway comment, and nothing flattens the rest of the bar to nothing.
  Heights are scaled to 70% of what they were: the bar should be readable at a glance,
  not shout.
- **How finely to carve the bar is a question about pixels, not seconds.** The bucket
  count follows the width available (about one mark per 6px) and never cuts the video
  finer than 1.5s, so a short video gets a few chunky marks instead of a row of slivers
  and a wide player never gets sub-pixel ones.
- **Full-strength red disappears into glass.** The more transparent and the more
  blurred the panel, the less a saturated accent reads against whatever is behind it.
  Lightening the text was not enough, because the panel is deliberately see-through and
  whatever is behind it sets the contrast. Timestamps sit on their own small dark chip
  instead, which fixes the contrast wherever the panel happens to be; the accent itself
  stays at full strength on the marks, the bracket and the countdown, where it sits on
  video rather than on glass.
- **An invisible preview keeps its box.** Ours is masked on release and YouTube's
  fades, so `getBoundingClientRect` still reports a rectangle for something nobody can
  see — which held the cards up over nothing. Computed visibility and opacity are
  checked before a box counts as a preview at all.
- **Collapsing has to restore the size before the rows are re-fitted.** Measured against
  the opened panel's height they came out unclipped, lost the `is-clipped` flag, and
  stopped being clickable — so a comment could be opened exactly once.
- **The stack and the preview both live at the bottom.** On a wide player they overlap,
  and the cards lost. `avoidPreview()` checks the two boxes on every watch tick and
  lifts the stack clear above the preview's top edge, capped so it cannot climb out of
  the player, and drops it back when the preview goes.
- **Past three cards, the rest wait rather than being shoved off.** The oldest used to
  be dismissed to make room, which threw away a comment before it had been read. They
  now queue behind a counter above the stack; opening it gives a scrollable list — the
  one surface in the extension that genuinely is a list, and so the only one that
  scrolls. Everything else sizes itself to what it holds.
- **The first pages of a video are its most-liked comments, and a timestamped comment is
  rarely a popular one.** Seven pages put a sample on the bar and called it the set. The
  extension now keeps reading in the background: the rest of that ordering, then the other
  orderings the page offers, six pages at a time, every comment going onto the bar as it
  lands and into the day's cache at the end. Measured on a music video, the worst case for
  timestamps: the first pass read 140 comments and found **zero** timed ones; the sweep
  read 860 and found **nine**, in about 44 requests and twelve seconds. Opening a window
  with View more starts the same sweep if it has not run, and the list grows under you as
  it arrives.
- **The other half of a timestamped comment is writing one.** The pen rides on YouTube's
  own time pill, which is already the label for the moment under the cursor — our element
  against theirs, not inside it, because they rewrite that label's contents on every frame
  of a scrub and anything of ours in there would be swept away. It opens a composer
  stamped with that exact moment, and what goes out is the stamp in front of your text. It is the same composer the replies use, with a different
  verb and a different endpoint — `comment/create_comment` with the token YouTube hands to
  the comment box at the top of the page, which a signed-out session is never given. No
  token, no button. The panel stops chasing the pointer while it is open, because a box
  that moves out from under you mid-sentence is not a box you can write in.
- **Opening a reply box is not a one-way door.** A card expanded into its reply box had
  no way back to itself: the only exits were closing the card outright or finding a
  chevron that only appeared on hover. The box carries a Cancel beside its Reply, and
  while a card is open the chevron stays visible instead of waiting to be found again.
- **A stack of cards is not bounded by the player.** One opened card with a thread under
  it is taller than the video on its own, and the cards above it ran off the top of the
  picture. The stack is capped at the room between its own bottom edge and the top of the
  frame, scrolls past that, and follows what you are looking at: to the newest card when
  one arrives, to the top of a card when you open it.
- **A card cannot change size because its neighbour left.** A column of flex items is as
  wide as its widest one, so when a long card went away the short one beside it visibly
  shrank. The stack is a fixed width rather than a maximum, and every card is that width
  from the moment it appears until it goes.
- **An extension that reloads under an open tab leaves its markup behind without its
  stylesheet.** Safari drops the CSS the previous copy injected, and what is left is our
  elements with no styling at all — an icon with only a viewBox draws at its intrinsic
  size, which is 300x150 of speech bubble across the video. Two answers, because either
  alone is a guess: every icon now carries its own width and height in the markup, and the
  script checks whether its own custom property still resolves and re-injects the
  stylesheet when it does not.
- **A card that slides in changes what there is to scroll.** While it travelled it sat
  outside the stack's content box, the stack scrolled to compensate, and the card appeared
  to overshoot and settle back. It fades in now and moves not at all; fading touches no
  geometry. The stack is told where to look after the card is in the layout rather than
  before it.
- **Forever is not a grace period.** The list goes almost at once when the pointer
  leaves; something you opened deliberately got no timer at all and sat on the video until
  it was clicked away. It closes on its own now, with a longer grace than the list — long
  enough to cross the screen to it, short enough that it is not still there when you have
  moved on — and closing resets it, so the next hover starts at the list rather than
  wherever the last one was left.
- **A panel that re-measures on every page of a thread jumps about while it fills.** A
  loading note, then eight replies, then eight more, each a different height, each
  re-measured. While one comment stays open the panel only grows, and the scroll position
  is carried across the re-render, so what you are reading stays where you started reading
  it.
- **Trimming the slack inside the render was not enough.** The panel is re-sized from the
  preview on every mouse movement, so a gap trimmed during a rebuild came straight back on
  the next move that did not rebuild. The trim runs wherever the panel is placed, not only
  where it is built.
- **A cached record is a fixed-shape tuple, so adding a field to it breaks yesterday's
  copies.** They come back missing whatever is new, silently — which is why a name was a
  link on a freshly fetched reply and plain text on the comment right above it, on the same
  screen. Entries now carry the shape they were written in, and one from an older shape is
  refetched rather than half-read. Verified live afterwards: 20 of 20 top-level comments
  come back with a channel path.
- **A name is a person.** Comments carry where their author lives — a handle where
  YouTube gives one, a channel id otherwise — so the name is a link wherever it is shown:
  in the list, on a card, in a thread. It opens in a tab of its own with the opener sealed
  off, because the video is still playing here, and it does not also open the comment or
  expand the card on the way past.
- **The writer is about the moment you are pointing at, not the last one that had
  something to say.** The panel holds the last stretch it found comments in, and the pen
  simply switched it back on — so writing about 0:54 could open under a comment from 1:08
  and a window that did not contain 0:54. Opening the writer rebuilds the panel for the
  moment under the cursor first, even when that leaves it empty. Empty is the honest
  answer there.
- **Two passes that measure differently will eventually disagree, and the gap between
  them is a bug.** Rows were fitted by arithmetic — a line height, a header height, a gap
  — and then checked geometrically, and the difference between the estimate and the truth
  was a row rendered where nobody could see it. There is one basis now: where the last row
  actually ends. Every row starts at one line, any row there is no room for is removed,
  and the spare lines are handed out one at a time and taken back the moment they do not
  fit. Nothing is assumed about how tall anything is.
- **Trimming the panel changed the panel's size, and the rebuild key watched its size.**
  So a trim triggered a rebuild, which re-fitted the rows against the trimmed box, which
  trimmed it again: a comment lost on every mouse movement until one was left. The key
  watches the size the geometry asks for, not the size the panel ended up at.
- **A box half empty under its own content looks like something failed to load.** The
  panel borrows the preview's height, which is generous for three short comments. After
  the rows are fitted, whatever slack is left under them is given back and the panel
  shrinks upward, keeping the bottom edge level with the preview's — the edge the two
  share.
- **A control that follows the pointer has to move at the pointer's rate.** The pen was
  repositioned on the 140ms watch tick, which is fine for something that sits still and
  visibly laggy for something riding a label that tracks the cursor. It moves on the same
  mouse event the pill does now. That is only affordable because the pill it is following
  is remembered rather than searched for each time: the search is a cheap text-and-box
  pass with style resolution on the single winner, and once it has an element it re-reads
  only the box until that element goes away. Re-picking it every frame was also what made
  it flicker between two candidates.
- **The pill is found by what it says, not by what it is called.** Class names were no
  help at all: several things in the player wear the tooltip classes, including the
  storyboard frame's own background and wordless boxes pinned inside it, and which one is
  the label changes with the layout — two attempts at scoring them by class and position
  both put the pen against the frame's edge. It is found by content instead: the smallest
  visible element in the tooltip whose text begins with a timestamp, then a climb of up to
  three parents to whatever actually paints the rounded background around it. That element
  is the pill, and it is the one we sample the colour and the corner from too.
- **A selection needs a margin of its own.** The hover highlight bleeds past the row it
  is about, so with the panel's old padding it landed flush against the panel's edges and
  the arrow hung over the border. The panel is wider inside by a couple of pixels and the
  bleed is narrower, which puts a visible margin between the selected comment and the
  frame around it.
- **A continuation arrives in two shapes and they are not interchangeable.** The comment
  list carries an endpoint that fires when it scrolls into view. A reply thread carries a
  *button* — "Show more replies" — with the token on the button's command instead. We read
  only the first shape, so every thread stopped at its first page and reported no
  continuation: a comment with 26 replies handed back ten and claimed that was all of
  them. Verified against the live endpoint with our own code, before and after: ten and a
  dead end, then 10, 48, 49, 50 with continuations.
- **A mark you can hover and get nothing from is a bug with a tooltip.** Comments with no
  timecode are given a slot and a mark on the bar, but the hover window was built from
  timestamped comments alone, so those marks answered with silence while their neighbours
  worked. The window now includes whatever the schedule has placed there.
- **Arithmetic got the last row nearly right.** Rows were sized by estimating the height
  of a header band and a line of text, which left the bottom comment sliced in half
  against the panel's edge. The estimate still decides how many to build; what is drawn is
  then measured, and anything hanging over the edge is removed. A half-drawn comment is
  worse than one fewer.
- **The way into a conversation cannot be an accident of length.** A card could only be
  opened when its text had been truncated, so a short comment with eleven replies had no
  way in at all — and the reply count next to it opened a text box instead of the replies
  it was counting. The count opens the thread now, with the reply box at the end of it,
  and any card with a conversation under it is openable whether or not a word was cut off.
  Its pill says Replies rather than Expand, because that is what is in there.
- **The alpha is what the eye sees, not what the property says.** A fill read at face
  value ignores whatever opacity its element is carrying, which is how a pill measuring
  a little under half black over a white background became a panel at nearly twice that.
  The sample is now multiplied by the element's own opacity and held inside the range
  their pill actually occupies. The element itself is picked by shape — the smallest
  visible label-sized box, not the first thing wearing the class.
- **Identical means giving up the things ours had that theirs does not.** Matching
  their colour was never going to be enough while our panel was blurred, gradient-lit,
  hairlined and floated on a shadow and their pill is a flat translucent rectangle. All
  four are gone, their alpha is used as sampled rather than normalised into a range we
  preferred, their corner radius is copied off the same element, and the timestamp inside
  is plain white text exactly where their pill puts the time. What is left is their
  rectangle with our content in it.
- **Their pill is see-through, so ours is too.** Taking their colour was half of it:
  a sample that comes back opaque, painted over a bright frame, reads as a black slab
  next to a grey pill. The alpha is normalised into the range their own label sits in —
  never solid, never so faint it cannot hold text — so the two read as the same object
  over the same picture.
- **A thread of 26 does not arrive as 8 and stop.** Replies come a page at a time, on
  the page and here, and the first page was all there was: no way to ask for the rest, and
  a pane that could not scroll to them anyway. The thread now pages in behind a
  `View more (N)` of its own, each reply carries its own like and reply counts and its own
  way to answer it, and the pane scrolls once the panel has run out of room to grow. That
  reverses an earlier rule that nothing inside the opened box should scroll: a comment
  with 26 replies is not something a box can be sized to.
- **A bare number is not an instruction.** The footer counted what was hidden and left
  you to work out that the number was a button. It says `View more (4)` now, with the
  chevron it always had.
- **Two colours are sampled, and everything is built out of them.** Their red, off the
  progress swatch, and the material of their label pill — the one the chapter title and
  the time sit in over the scrub preview. Every surface we draw over the picture is made
  of the second one: the panel, the cards, the menus, the chips. A see-through slab of
  our own was legible only over a quiet frame and never looked like part of the player.
  The blur stays, because that is what keeps text readable over a busy picture; the
  colour is theirs. A chip on a panel of the same material steps one shade further the
  way the material already leans, so it still reads as a chip.
- **A menu cannot be a race.** The snooze menu was torn down the moment the cards that
  prompted it timed out, which was usually before it could be read. Opening it holds
  every card, so nothing expires underneath it, and it closes on a choice, on a click
  anywhere else, on Escape, or on the button again.
- **One switch, not one per card.** What you want when comments are in the way is
  quiet, not this particular comment gone — so the stack carries a single snooze, for
  five minutes or for the rest of the video. The same switch is built into YouTube's own
  settings menu, in their markup and taking their styling, because that is where people
  already look for the player's switches. Their panel is sized in JavaScript when it
  opens, so it is given back the height the extra row costs.
- **One failed start used to be the only start.** Autoplaying into the next video
  changed the URL once, ran setup once, and if that attempt found a player mid-rebuild
  there was nothing to try again — the extension sat dead until the viewer navigated by
  hand, reporting no video open. The watch now compares what is set up against what is on
  screen rather than watching the URL alone, so a missed start heals itself a beat later.
  The regression test fails without it.
- **Opening a card opens the comment, not just the text.** It unclamps, holds its own
  countdown, and fetches the thread underneath — the same two bands as everywhere else,
  six replies deep. Nothing is fetched until it is opened, and closing it puts the
  replies away and starts the clock again.
- **A settings panel is a list of decisions, not a list of switches.** The marks toggle
  went first: nobody turns the marks off, and a switch that is never moved is noise in
  front of the ones that are. What is left is shaped by what it belongs to — the likes
  threshold sits under the pop-out toggle it serves and greys out with it, the two numbers
  nobody changes twice are behind an Advanced fold with the manual fetch, and the count of
  what was found on this video leads, re-read while the panel is open because the
  background sweep is still adding to it. A button to throw the cached comments away sits
  at the bottom, where the thing you rarely want lives.
- **Anything posted from here says which moment it is about.** A reply sent from a card
  or from the panel goes out with the video timestamp in front of it, which is what makes
  it a comment about a moment rather than a comment about a video — and YouTube turns a
  leading stamp into a link by itself. The stamp is taken when the composer opens, not
  when Send is pressed, because the video keeps playing while you type. It is shown in
  the composer, so nothing leaves the browser that the viewer has not seen.
- **One control, not two.** The card carried a reply button and, next to it, a reply
  count: two speech bubbles side by side saying almost the same thing. The count is the
  button now. In the panel it opens the comment with a composer underneath, where there
  is room to type and the comment is in front of you; on a card it opens in place.
- **A name is not a column.** Comments were laid out with the author beside the text, so
  every comment started at a different indent and none of them lined up — and in the list
  the name was not shown at all. Each comment is two bands now: who and when across the
  top with the counts in the corner, the comment itself underneath. Replies are built the
  same way.
- **The panel is sized for the comments, not only for the preview.** Borrowing the
  preview's height meant a short preview left room for a row and a half. It now takes
  whichever is larger, the preview's height or the room three comments need, growing
  upward so the two still end level.
- **Their label is white on grey, so ours is too.** Red text on the sampled pill was the
  last thing that did not read. The accent keeps the places it belongs — the marks, the
  countdown, the send button — and the chips are YouTube's own material with YouTube's
  own contrast.
- **The hint is not where its class says it is.** "Pull up for precise seeking" is drawn
  above the preview, outside the box we measure, and matching it by class found nothing —
  so the cards cleared the preview and were then painted over by the hint. The preview's
  box is extended upward by 34px to cover whatever YouTube puts there.
- **The fill is a tally, not a gate.** Filling the mark over the run-up to its first
  card, then holding it full, read as though the mark had to finish before anything could
  happen — and on a mark holding three comments it looked like all three were waiting for
  it. It now counts them out: each comment still surfaces a beat after its own timecode,
  the mark grows a share as each one lands, and it is full exactly as the last of them
  appears. Each landing gives the mark a beat of its own, and it drains when the last
  card goes.
- **The opener is an object, not a decoration.** Underlining a truncated comment made it
  look like a link and said nothing about what clicking would do. Pointing at one now
  selects it and floats a small pill over its right edge; the whole comment is still the
  button. The card does the same thing, and its pill says Collapse once it is open.
- **The panel shows what it can hold and counts what it cannot.** Three rows was a
  constant, so a tall preview wasted its own space and a selection covering four marks
  listed three comments with no sign of the fourth. Rows are fitted against the measured
  panel — up to six — any that cannot get a line of their own are removed rather than
  rendered into the overflow where they were invisible, and the footer's count is
  measured after that, against what is actually on screen.
- **The panel and the cards are not rivals.** Cards used to be suppressed while the
  scrub list was up, on the theory that two comment surfaces at once is noise. What it
  actually did was swallow comments for as long as you kept the pointer on the bar. They
  coexist now; the stack lifts itself clear of the preview, which is the collision that
  mattered.
- **The marks are related to the chart, not trapped under it.** Clamping every mark
  below the "most replayed" curve flattened whole stretches to a hairline and made the
  loud ones all the same height, because the curve, not the comments, was deciding.
  Inside the chart they are now scaled against the chart's own box at a fraction of it —
  the same family, a smaller instrument. The curve-sampling machinery went with it.
- **A count of replies is a different fact from a count of likes.** A comment with a
  thread under it is worth opening; one with 1.1K likes and no answers is not the same
  invitation. `commentEntityPayload.toolbar.replyCount` carries it, so it sits beside the
  like count everywhere a comment is shown, and shows nothing at all at zero.
- **The list dissolves, it does not snap.** Scrubbing rewrites it continuously, and
  swapping the text in place flickered. The outgoing rows are left in position for 110ms,
  fading out over the incoming ones — long enough to read as a dissolve, short enough
  that dragging the bar never looks like it is lagging behind the pointer.
- **The panel has to leave when the preview leaves.** Both are gone in the same gesture,
  but ours was checked on a 150ms poll and visibly outlived YouTube's. The cheap check
  now runs at 70ms and the DOM work every other tick, which costs nothing and removes the
  lag entirely.
- **A hidden tab is not an audience.** Card countdowns are timers, and a background tab
  throttles them, so cards were waiting on screen long after their time was up — and a
  video the browser had paused held them open indefinitely. Hiding the tab dismisses
  what is on screen, and anything whose time has run out is swept on the watch tick
  rather than trusting its own timer.
- **A card fading out still had its comment's name on it.** The dedupe key survived
  dismissal for the 300ms of the fade, so a comment could not come back during it — which
  is exactly the window a rewind lands in. The key is cleared when the card is dismissed,
  not when it is finally removed.
- **Google's own label is a material, not a colour to guess at.** The pill YouTube puts
  the chapter title in over the scrub preview is sampled off the live element the first
  time a preview appears, and our own chips are painted with it. Its luminance also picks
  the text colour, because that pill is light in some themes and dark in others and a
  fixed foreground is only ever right in one of them.
- **A mark answers for its own comments.** The bar used to sit there while cards
  appeared from nowhere beside it. Each mark now fills with a lighter shade of its own
  colour over the 2.5s run-up, is full at the instant its first card lands, stays full
  while any of them is on screen, and drains once the last one has gone. The fill is
  painted *after* the cards are shown, not before: painted first, a mark read empty for
  the one frame its card appeared in, which is exactly the frame you are looking at it.
- **A comment with no timecode still lands somewhere.** Spreading them across the empty
  stretches fixed one problem and created another — they arrived with nothing on the bar
  to have announced them. Their slots now get a short, plain mark of their own, dimmer
  and shorter than the timed ones, so the bar still says where everything is without
  claiming those moments are busy.
- **A counter is about what is on screen, not what the video contains.** The overflow
  list only ever grew, so a `+6` from a pile-up 200 seconds ago was still sitting beside
  a single card much later. It is dropped when the last card goes and when you seek, and
  it only appears past four comments — below that, you can just look at them. It is not
  dropped while the list is open and being read.
- **A card stating its own timestamp says nothing.** It arrives *because* that moment
  just played, so the time is the one thing the viewer already knows. The card was given
  a timestamp chip twice over two rounds and taken away twice; it stays away. `TOP` is
  different and keeps its badge, because that card is not about any moment at all.
- **Replying is a public write, so it is deliberate twice over.** `POST
  comment/create_comment_reply` with the thread's own `createReplyParams`, signed like
  the like. Nothing is sent by opening the card or by opening the composer — only the
  send button posts. Writing holds the card's countdown, and single keystrokes are
  stopped from reaching the page, or typing a space would pause the video and `f` would
  go full screen.
- **The cards have to dodge more than the preview.** "Pull up for precise seeking" sits
  just above the bar, exactly where the stack starts, so the two collided even with no
  preview open. Both are obstacles now, the stack lifts clear of whichever is worse, and
  it sits further off the bar to begin with.
- **A comment is a reaction, so it arrives after its moment.** Firing the card the
  instant the playhead reached the timecode handed you the punchline on the way in.
  `POPOUT_LAG` holds it until the moment has actually played — 2.5s, which is long
  enough to have seen what the comment is about and short enough to still feel attached
  to it. It is one constant; a comment stamped 2:37 lands at 2:39.5.
- **Comments with no timecode fill the gaps.** They used to queue up in the last fifteen
  seconds. Now they take the centres of stretches the timed ones leave empty — which on
  a video whose timestamps all cluster in one place is most of it, and on a
  well-covered one is none at all.
- **A paused video pauses everything on top of it.** Cards can be frozen for more than
  one reason at once — you are reading one, and the video is stopped — so a card keeps a
  set of holds and only resumes when the last one lifts.
- **Ten seconds is not a fixed quantity.** It is a third of a short clip and a rounding
  error in an hour-long one, so the hover window scales with the video (4%, clamped to
  8–120s) unless a number is pinned in the settings. The selection bracket now only
  appears where there is something inside it to select.
- **A phone is not a desktop.** A card covers far more of a small screen, so the bar to
  earn one is three times higher there, with a floor — `likeFloor()`.
- **Sign the reads, not just the write.** InnerTube decides who is asking from the
  `SAPISIDHASH` header, not from cookies: an unsigned `/next` comes back as the
  logged-out variant, whose comment toolbar holds a sign-in modal where the like action
  would be. Measured on the live page: the signed request carries 80 like endpoints, the
  anonymous one zero. So every request is signed when a session exists. The action
  itself lives on `engagementToolbarSurfaceEntityPayload`, reached through the
  view-model's `toolbarSurfaceKey` — not on any button inside the thread.
- **A container is not a chart.** A video without "most replayed" data still gets
  `.ytp-heat-map-container`, at zero height, forever. Parenting the marks into it hid
  them outright and made the folded-chart tag fire permanently. A chart only counts as
  one if it carries a path with geometry; otherwise the marks keep their own strip.
- **The curve can arrive after the marks.** Re-homing into a chart that appeared later
  moved the bars but left them sized without it, so they are rebuilt against it.
- **Bursts compete on quality, not arrival.** Taken in time order, a lone one-like
  comment claimed the cooldown slot and silenced three well-liked ones 27 seconds later
  (observed at 6:49 on a real video). Bursts are ranked by their strongest comment; ties
  break on time, so the outcome is still fixed for a given video.
- **Verified against the live player, not assumed.** Three things only a real page
  could tell us, each of which had silently broken a feature:
  `.ytp-heat-map-container` is `overflow: hidden`, so the bracket hung below its own
  box was clipped away and only its end caps survived; the container ships **two**
  paths and `.ytp-heat-map-path` is *empty* — the geometry is on
  `.ytp-modern-heat-map`, so selecting by class selected the blank one and disabled
  the clamping entirely; and `.ytp-play-progress` is painted with a *gradient*, so its
  `backgroundColor` reads transparent and the accent sampling always fell through.
  Pick the path by whichever has a non-empty `d`, read the colour off
  `.ytp-scrubber-button` (solid) or out of the gradient, and keep the bracket inside
  its own box.
- **Chaptered videos draw one SVG per chapter.** Each has its own local coordinates, so
  every segment is mapped back onto the container's width by its own rect. Treated as a
  single curve, a mark early in chapter two gets the ceiling of a point midway through
  the video — measurably wrong: in the test that same bucket goes from 54% to 14%.
- **"Within the chart" means under the curve.** Hosting the marks inside YouTube's
  container gets the box right but they still poked out the top of the line. The curve
  is an SVG path, so `curveProfile()` walks it with `getPointAtLength`, takes the
  highest point per bucket (the path closes along its own baseline, so the *lowest* y
  at an x is the top of the curve), and that becomes the ceiling each mark scales into.
  Cached against the path data, since the walk is the expensive part.
- **Fine scrubbing is a takeover, not a preview.** Pulling up on the bar gives YouTube
  the whole player, and the panel was sizing itself against that box — so it grew to
  fill it. Boxes taller than half the player are now rejected as previews, the panel
  stands down entirely while that mode is on, and its height is capped regardless as a
  backstop.
- **YouTube drops its preview the instant you leave the bar**, which makes both the
  preview and the panel beside it unreachable. While the pointer is on either, the last
  bar position is replayed onto the bar so YouTube's own handlers keep it up. It stops
  the moment you leave, so the preview still governs when everything goes.
- **A comment without a timecode is not a comment without value.** It just isn't about
  any one moment, so the best few are held back and played out across the last 15
  seconds — and their cards say `TOP` rather than claiming a timestamp they don't have.
- **Their red, sampled not guessed.** `--scrubber-accent` is read off YouTube's own
  progress swatch at runtime and published as a custom property, so the marks track
  their brand colour instead of approximating it — and follow it if they change it.
  Panels borrow YouTube's chrome grey, Roboto, and the scrub preview's own radius.
- **Two comment surfaces at once is noise.** Cards hold off while the scrub panel is
  up. What they miss is queued rather than lost, and when the panel goes only the last
  3 seconds' worth still describes what is on screen — the rest is dropped instead of
  dumped all at once.
- **The panel's life is the preview's life.** Leaving the bar keeps a 220ms grace,
  because reaching the panel means crossing YouTube's preview. But once that preview is
  gone, scrubbing is over, and the panel goes immediately. The preview can vanish with
  no mouse movement at all — the controls auto-hide — so it is polled, not only checked
  on mousemove.
- **YouTube already has a chart up there.** On videos with "most replayed" data it
  draws a curve in its own container. Measuring that box and floating above it left the
  marks sitting *on* the chart rather than in it, so they are now moved **into** the
  container as its first child: they inherit its exact geometry, its visibility and its
  show/hide animation for free, and YouTube's own SVG paints over them so the white line
  stays on top. Folding the curve away therefore folds the marks away too, with nothing
  here to keep in sync. On a comment-heavy video that would leave no signal at all, so
  past `TAG_MIN` a single tag rides the bar instead.
- **Comments do not exist until they scroll into view.** A freshly opened video has
  none rendered, so the bar is empty until you go and fetch them — the one bit of work
  this is meant to save. Scrolling the page to force them in was visible and horrible.
  `innertube.js` asks YouTube instead: `POST /youtubei/v1/next` with the video id for
  the comments continuation, then that token for each page. Same origin, same session,
  same call the page makes when you scroll. Nothing moves on screen. The scroll walk
  survives only as a fallback for when that endpoint changes, so a break means fewer
  marks rather than none.
- **Two comment shapes are live at once.** Current responses ship bodies as
  `commentEntityPayload` entities in `frameworkUpdates`, beside renderers that only
  reference them by key; older ones still use a self-contained `commentRenderer`.
  `extract()` reads both and lets the `seen` key de-duplicate. Timestamps come from
  `commandRuns` / `navigationEndpoint` where present, and fall back to the same plain
  text regex the DOM path uses. Everything is searched by key rather than a fixed path,
  because these shapes move.
- **Rewinding has to re-arm the pop-outs.** `S.fired` stops a card firing twice, but it
  only ever grew, so a rewatched stretch stayed silent for the rest of the page. A
  backwards seek now drops every fired mark at or after the new position and clears the
  cooldown — without the second part a quick rewind is swallowed by the 30s gap.
- **A hidden element measures zero.** The panel is `display:none` until it is switched
  on, and the line fitting ran *before* that — so it read a height of 0, bailed out, and
  left every row both unclamped (falling back to the stylesheet's two lines) and
  unflagged, which is why a visibly truncated comment stopped being clickable. It is
  switched on first now, and the fitting no longer bails: with nothing to measure it
  assumes those two lines and still marks what is clipped.
- **A held card resumes, it does not restart.** Hovering banks the time remaining;
  leaving reschedules exactly that. The countdown bar needs no help — CSS un-pauses it
  on its own when the hover ends, so only the dismissal is rescheduled.
- **Liking is a write, so it is signed and it is manual.** `POST comment/perform_comment_action`
  needs the `SAPISIDHASH` the page itself sends — a SHA-1 over timestamp, SAPISID cookie
  and origin. The action string lives on the thread's toolbar rather than the comment
  body, in both shapes. It fires only from a click, never automatically, and there is no
  un-like: the action is specifically a like, so a chip retires once used.
- **A fixed-size panel wastes its own space.** The box borrows the preview's height,
  so three short comments used to leave half of it blank. `fitRows()` measures each
  comment's natural height, gives every row one line, then hands the spare lines out
  round-robin to whoever is still cut off. Only rows that are *still* truncated after
  that get `is-clipped`, which is both the underline and the click target — so the
  affordance never appears on a comment you can already read in full.
- **Opening grows the panel upward, not downward.** Its bottom edge is pinned to the
  preview's, and it extends up by at most 30% of the player height before switching to
  an internal scroll. Replies expand in place under the same rule: by then the box is
  already at its ceiling, so they push into the scroll rather than moving it.
- **Reply tokens only exist on the thread.** `commentThreadRenderer` carries the
  replies continuation next to a comment that is itself only a `commentKey` pointing
  into `frameworkUpdates`. `extract()` walks threads first to keep the token attached
  to the right comment, then sweeps whatever no thread covered — which is also how a
  replies page, having no threads at all, still parses.
- **An interactive panel has to defend itself.** Reaching it means crossing YouTube's
  preview, which is not the panel, so a plain mouseleave dismissed it mid-journey:
  hiding is deferred 220ms and cancelled on entry. Clicks are swallowed before they
  reach the player, which would otherwise seek or pause underneath.
- **YouTube's scrub preview owns the same strip.** The storyboard frame, "Pull up for
  precise seeking" and the time bubble sit exactly where the tooltip did, and painted
  over it. The tooltip now measures that box at hover time and sits *beside* it —
  borrowing its top edge, height and corner radius so the two read as one unit — and
  reads its z-index rather than hardcoding one. It prefers the right, flips left near
  the player edge, and falls back to floating above the bar when no frame is up. The
  panel is translucent with a backdrop blur: enough to see the video through, enough
  blur to keep the text legible over it.
- **The timestamp was printed twice.** Comments open with the time they are about
  ("5:38 this joke kills") and every surface already shows that in its own column.
  `trimLeadStamp()` drops the leading stamp, but only when it equals the time being
  captioned, so a comment listing several keeps the ones it isn't captioning.
- **Selectors are the maintenance tax.** Desktop: `ytd-comment-thread-renderer`,
  `#content-text`, `#author-text`, `#vote-count-middle`, `.ytp-progress-bar-container`.
  Mobile: `ytm-comment-thread-renderer`, `p.YtmCommentRendererText`,
  `span.YtmCommentRendererTitle`, `.YtmCommentRendererCount`. First thing to check when
  it breaks.

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

## Writing, not just reading

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

## Not built yet

One-keypress emoji marks, which is where density actually comes from.
