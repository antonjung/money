# Money

## Overview

PWA to track expenditure by category.

Self-contained, no backend — data lives in localStorage on the device.

## Data

`localStorage['money-data']`:

```
categories: [{ id, name, budget }]
months:     [{ id, label, startedAt, endedAt, spends: [{ id, categoryId, amount, note, at }] }]
```

`at` is a `YYYY-MM-DD` date string, always today's date at creation — not
edited at entry, only afterwards (see List below). `note` is always stored
empty for new spends (the field was removed from entry — kept in the schema
only so any pre-existing notes still display in List). `months` is
append-only and chronological; the last entry (`endedAt === null`) is the
current month. Categories are global and shared across months, each with an
optional monthly `budget` (0 = none set).

## Functions

Bottom nav, four screens (icon + label, like the `rehearsal` app):

### Home (spend view)
Entry-only — category, amount — nothing else, so it's as fast as possible for
repeated use. Blurs the amount field after adding (closes the numeric
keypad) rather than refocusing it, and plays a soft two-note chime
(`playAddedSound`, same lazy-AudioContext-in-a-user-gesture pattern as the
`timeit` app) as an audible confirmation. The category picker is an
expandable list
(trigger button + chevron that flips, tap a row to pick and it closes), the
same pattern `rehearsal` uses for "Download from shared library" — not a
native `<select>`; the period picker in Summary uses the identical pattern.
If there are no categories yet, the form is replaced with a prompt to add one
(categories are managed on their own screen now, not created inline here).

### List (history view)
The current period's recorded spends: date is editable inline (the only place
a spend's date can be changed), delete asks for confirmation.

### Summary (report view)
Choose a period (default: current). One `<li>` per category (union of both
periods' categories, sorted by main-period spend), each holding its own
period rows stacked vertically — main period first, then the compare period
directly underneath, both with the identical amount/share/budget-bar
treatment (see below) — plus a change line under the pair. There's no
separate comparison list anymore; that was the whole point of stacking them
per category instead.

Each period row shows amount, share of that period's total, and a bar that's
always full width and two-toned when the category has a budget: under
budget it's spend (blue) + headroom (green); over budget it's budget (blue)
+ the overspend (red) — so blue always represents "budget" and shrinks
proportionally once you go over it. No-budget categories keep a single-color
bar sized relative to the biggest category *in that period* (main and
compare periods are scaled independently, since their totals can differ a
lot). A category with spend in only one of the two periods still gets both
rows — the other just shows £0.00 (with a full green bar if it has a budget).

A second picker ("Compare with") sets which period that second row is —
defaults to whatever's immediately before the main period chronologically,
same as before, but the user can pick any other period instead. Its list
excludes the main period (comparing a period to itself isn't useful) and
only resets to the default when the current choice becomes invalid (main
period changed to match it, or it no longer exists) — switching the main
period otherwise keeps an explicit comparison choice.

Period management lives here too, next
to the picker: rename (pencil icon), delete (bin icon, confirmed), and start
new (button below, prompts for a name prefilled with today's date). Deleting
the current period reopens whatever's now last as current; deleting the last
one leaves a fresh empty period (the app always has at least one).

### Categories
Add a category (name + optional monthly budget together, one step) and edit
any category's budget inline. This is the only way to create a category —
there's no quick-add from Home, to keep that form from doing two jobs at once.

## Group sharing

The header icon (share glyph, top right) opens the Sharing dialog — set a
group name + PIN there to share data live with anyone using the same pair
(across devices/users) via Firestore, project `money-app-antonjung`
(dedicated to this app, matching the rest of the GitHub.io suite). Optional —
the app works fully offline until a group is set. (There's no general "..."
menu any more — period management moved to Summary, sharing is its own
button, since a catch-all menu for two unrelated things was the whole
problem.)

Once in a group, "Invite others" (`inviteToGroup` in app.js) builds a link
with the group name + PIN in the URL hash (`#group=X&pin=Y`, matching
rehearsal's `#org=X&pin=Y` invite pattern) and hands it to `navigator.share`
if available, otherwise copies it to the clipboard. Opening that link
(`joinGroupFromUrl`, checked before the normal silent reconnect on load)
strips the hash and joins that group automatically — same `joinGroup` path
as typing it in manually, so the existing "replace this device's data?"
confirmation still applies if the device already has local data.

- `groups/{sha256(normalized name)}` — one document per group, whole-state
  (categories + months), last-write-wins.
- Content is AES-GCM encrypted with a key derived (PBKDF2, 100k iterations,
  name as salt) from name + PIN — never sent anywhere. Firestore rules
  (`firestore.rules`) stay open; a reader without the right PIN just gets
  ciphertext it can't decrypt. Same approach as the `rehearsal` app's shared
  script library.
- A realtime `onSnapshot` listener applies remote changes as they arrive;
  every local mutation re-encrypts and overwrites the whole doc.
- Deploy rule changes with `firebase deploy --only firestore:rules --project money-app-antonjung`.

## Versioning

`APP_VERSION` in `app.js` and `CACHE` in `sw.js` are bumped together on every
deploy. Bumping `CACHE` is what makes the browser notice `sw.js` changed,
which triggers the "new version available" banner (see `sw.js` comments) —
the banner offers a reload rather than forcing one.

Every version bump also gets an annotated git tag (`vX.Y`, matching
`APP_VERSION`) pushed alongside the commit, and the latest one gets a GitHub
Release — so the version is visible directly on GitHub (Tags list, and the
Releases card on the repo homepage) without having to open a commit and read
`app.js`.
