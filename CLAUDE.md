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

### spend / history / report tabs
Spend is entry-only (category, amount, date, optional note) — it doesn't list
anything, so it stays fast to use repeatedly. History shows the current
month's recorded spends (editable date, delete with confirmation). Report
covers everything else per-month.

### start new month
Prompts for a name (prefilled with today's date, editable) and archives the
current month (sets `endedAt`) before starting the new one.

### delete month
From Report, deletes the selected month and its spends (confirmed — this
can't be undone). Deleting the current month reopens whatever month is now
last as current; deleting the last remaining month leaves a fresh empty one
(the app always has at least one month).

### add spend
Pick an existing category or add a new one inline (budget set separately, via
the category list in the menu), enter an amount and date (defaults to today,
changeable both at entry and afterwards in History), optional note.

### report
Choose a month (default: current). Shows the category breakdown (amount,
share of total, and — if the category has a budget — over/under and by how
much) and compares it against the month immediately before it chronologically
(per-category delta).

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
