# Money

## Overview

PWA to track expenditure by category.

Self-contained, no backend — data lives in localStorage on the device.

## Data

`localStorage['money-data']`:

```
categories: [{ id, name }]
months:     [{ id, label, startedAt, endedAt, spends: [{ id, categoryId, amount, note, at }] }]
```

`months` is append-only and chronological; the last entry (`endedAt === null`) is
the current month. Categories are global and shared across months.

## Functions

### start new month
Archives the current month (sets `endedAt`) and starts a new, empty one.
Confirmed via dialog since it can't be undone from the UI.

### add spend
Pick an existing category or add a new one inline, enter an amount (+ optional
note), record it against the current month. Spends can be deleted individually
(mis-entries happen).

### report
Choose a month (default: current). Shows the category breakdown (amount +
share of total) and compares it against the month immediately before it
chronologically (per-category delta).

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
