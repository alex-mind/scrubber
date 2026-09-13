# Data usage disclosure — the checkbox form

Chrome Web Store requires every developer to certify these before publishing, and a
mismatch between what's ticked here and what the code does is one of the most common
rejection reasons. Edge Add-ons asks a shorter version of the same thing.

## "What user data do you plan to collect?"

Tick **nothing**. Every category stays unchecked:

| Category | Collected? |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity (clicks, mouse position, scroll, keystrokes) | No |
| Website content (text, images, sound, files) | No |

The one worth pausing on is **Website content**. Scrubber does read comment text from
the YouTube page — but "collect" in this form means transmitting or persisting data off
the user's device. Comment text is parsed for timestamps in memory, rendered, and
discarded with the page. It is never sent anywhere and never written to storage. It is
therefore not collected.

Settings are the user's own configuration, not user data, and live in the extension's
own `storage` area.

## The three certification checkboxes

All three are true and must be ticked:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy URL

Required once the account handles any user data, and harmless to supply regardless —
supplying one costs nothing and removes a whole class of reviewer doubt:

```
https://alex-mind.github.io/scrubber/privacy.html
```

## Account / identity

- Publisher email: alex.mindar.planes@gmail.com (must be verified in the dashboard
  before the first submission — do this early, it gates publishing)
- Trader status: **Non-trader**, if you're publishing a free extension as an individual
  with no commercial purpose. The EU DSA requires this answer; getting it wrong is a
  compliance problem, not a review nitpick. If you ever monetise it, revisit.
