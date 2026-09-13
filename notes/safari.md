# Safari

Everything below fails *silently* when it goes wrong — the converter exits 0, Safari
shows no error, the extension simply does nothing. That is why each trap is written
down rather than left to be rediscovered.

Safari is build-it-yourself and will stay that way for now: shipping a Safari extension
means a **$99/yr Apple Developer Program** membership, and every release has to be
wrapped in a native app and pushed through App Store review. That is a lot of recurring
cost and ceremony for the smaller of the two audiences, so Chrome and Edge go first.
Building it locally costs nothing.

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
