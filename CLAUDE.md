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

`at` is a `YYYY-MM-DD` date string (the spend's date, editable — not a created-at
timestamp). `months` is append-only and chronological; the last entry
(`endedAt === null`) is the current month. Categories are global and shared
across months, each with an optional monthly `budget` (0 = none set).

## Functions

Bottom nav, four screens (icon + label, like the `rehearsal` app):

### Home (spend view)
Entry-only — category, amount, date (defaults to today, editable), optional
note — no list, so it stays fast to use repeatedly. If there are no
categories yet, the form is replaced with a prompt to add one (categories are
managed on their own screen now, not created inline here).

### List (history view)
The current period's recorded spends: date is editable inline, delete asks
for confirmation.

### Summary (report view)
Choose a period (default: current). Shows the category breakdown (amount,
share of total, and — if the category has a budget — over/under and by how
much) and compares it against the period immediately before it
chronologically (per-category delta). Starting/deleting a period both live
here: start prompts for a name (prefilled with today's date, editable) and
archives the current one; delete removes the selected period and its spends
(confirmed — can't be undone). Deleting the current period reopens whatever's
now last as current; deleting the last one leaves a fresh empty period (the
app always has at least one).

### Categories
Add a category (name + optional monthly budget together, one step) and edit
any category's budget inline. This is the only way to create a category —
there's no quick-add from Home, to keep that form from doing two jobs at once.

## Group sharing

Set a group name + PIN in the menu to share data live with anyone using the
same pair (across devices/users) via Firestore, project `money-app-antonjung`
(dedicated to this app, matching the rest of the GitHub.io suite). Optional —
the app works fully offline until a group is set.

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
