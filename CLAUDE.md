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

## Versioning

`APP_VERSION` in `app.js` and `CACHE` in `sw.js` are bumped together on every
deploy. Bumping `CACHE` is what makes the browser notice `sw.js` changed,
which triggers the "new version available" banner (see `sw.js` comments) —
the banner offers a reload rather than forcing one.
