# Money

## Overview

PWA to track expenditure by category.

Self-contained, no backend — data lives in localStorage on the device.

The header (title + version) is `position: sticky` so it stays visible while
a screen's content scrolls beneath it (History, Categories, and Summary can
all get long).

## Data

`localStorage['money-data']`:

```
categories:     [{ id, name, budget }]
months:         [{ id, label, startedAt, spends: [{ id, categoryId, amount, note, at }] }]
currentMonthId: string | null
```

`at` is a `YYYY-MM-DD` date string, always today's date at creation — not
edited at entry, only afterwards (see List below). `note` is always stored
empty for new spends (the field was removed from entry — kept in the schema
only so any pre-existing notes still display in List). `months` is
append-only (creation order), each with its own independent `startedAt`, but
**creation order no longer implies "current"** — `currentMonthId` is the
single source of truth for which period Home adds to, settable explicitly to
any period from the Periods tab. A fresh install starts with `months: []`
and `currentMonthId: null` — there is no auto-created default period, and
zero periods is a perfectly normal ongoing state (e.g. after deleting the
last one), not just a transient first-run one. Categories are global and
shared across months, each with an optional monthly `budget` (0 = none set).

`loadData()` migrates pre-`currentMonthId` saves: the old convention (the
month with `endedAt === null`, or failing that the last one) becomes the new
`currentMonthId`, so nobody's "current period" silently changes on upgrade.

## Functions

Bottom nav, five screens (icon + label, like the `rehearsal` app):

### Home (spend view)
Entry-only — category, amount — nothing else, so it's as fast as possible for
repeated use. Blurs the amount field after adding (closes the numeric
keypad) rather than refocusing it, plays a soft two-note chime
(`playAddedSound`, same lazy-AudioContext-in-a-user-gesture pattern as the
`timeit` app), and shows a toast ("£X added to Category") that fades out
after ~2.2s (`showToast` — a fixed `#toast` element toggling a `.show` class
for the fade, positioned like `#updateBanner`). The category picker is an
expandable list (trigger button + chevron that flips, tap a row to pick and
it closes), the same pattern `rehearsal` uses for "Download from shared
library" — not a native `<select>`; the period picker in Summary uses the
identical pattern.

Two empty states, checked in priority order since the missing-period one is
more fundamental: no current period → prompt with a "Go to Periods" shortcut
(`switchToView('periods')`); current period but no categories → prompt to
add one (categories are managed on their own screen, not created inline
here).

### List (history view)
The current period's recorded spends: date is editable inline (the only place
a spend's date can be changed), delete asks for confirmation. Shows a "no
current period" prompt if there isn't one.

### Summary (report view)
Empty state if there are no periods at all (`data.months.length === 0`) —
otherwise, choose a period (default: current). One `<li>` per category
(union of both periods' categories, sorted by main-period spend), each
holding its own period rows stacked vertically — main period first, then the
compare period directly underneath, both with the identical amount/budget-bar
treatment (see below) — plus a change line under the pair. There's no
separate comparison list; that was the whole point of stacking them per
category instead.

Each period row shows the amount and a bar that's always full width and
two-toned when the category has a budget: under budget it's spend (blue) +
headroom (green); over budget it's budget (blue) + the overspend (red) — so
blue always represents "budget" and shrinks proportionally once you go over
it. No-budget categories keep a single-color bar sized relative to the
biggest category *in that period* (main and compare periods are scaled
independently, since their totals can differ a lot). A category with spend
in only one of the two periods still gets both rows — the other just shows
£0.00 (with a full green bar if it has a budget). No share-of-total
percentage is shown — it was more noise than signal here.

A second picker ("Compare with") sets which period that second row is —
defaults to whatever's immediately before the main period chronologically
(by array/`startedAt` order, unrelated to `currentMonthId`), but the user can
pick any other period instead, or `NO_COMPARE` ("None") to show just the main
period with no second row or change line at all. Its list excludes the main
period (comparing a period to itself isn't useful) and only resets to the
default when the current choice becomes invalid (main period changed to
match it, or it no longer exists) — switching the main period otherwise
keeps an explicit comparison choice, including an explicit "None".

This is purely a *viewing* picker — which period Home adds to is a separate,
independent concept (see Periods below). You can view July's report while
August is current for spend entry.

### Categories
Add a category (name + optional monthly budget together, one step) and edit
any category's budget inline — the total re-renders on every budget change
(`renderCategoriesView` re-runs after `setCategoryBudget`, not just once on
open), so it can't go stale while you're editing. This is the only way to
create a category — there's no quick-add from Home, to keep that form from
doing two jobs at once. Shows the combined budget total across all
categories above the list when any category has one set.

### Periods
All period management lives here, replacing what used to be split between a
"start new period" flow (prefilled with today's date — confusing, since it
looked meaningful but wasn't) and Summary's rename/delete icons. Each row is
a single compact line: name (+ "Current" badge) and total spend on the left,
icon actions on the right — no `.btn-link` text button, every action here is
a small icon (`.icon-btn-square`, 16px glyph in ~8px padding) so the list
stays tight even with three actions per row:

- **Add** (`addPeriod`): name only, no date-based default — forces picking an
  actual meaningful name. Doesn't switch to it (see Make current) *unless*
  it's the very first period ever, which becomes current automatically since
  otherwise there'd be no way to add a spend without an extra manual step.
- **Make current** (check-circle icon, `setCurrentMonth`): shown on every
  period except the current one. This is the only thing that changes what
  Home adds to — entirely decoupled from creation order or which period
  Summary happens to be viewing.
- **Rename** (pencil icon) and **delete** (bin icon, confirmed) — reuse the
  same dialog/confirm patterns as everywhere else. Deleting the current
  period falls back `currentMonthId` to whatever period was created most
  recently, if any; deleting the last remaining period leaves `currentMonthId`
  null (same as a fresh install — zero periods is fine).

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
as typing it in manually. `joinGroup` skips the "replace this device's
data?" confirmation when the device is already configured for that same
group (compares against what's in `GROUP_STORAGE_KEY`) — reconnecting via
your own invite link isn't a data-replacing *switch*, so it shouldn't
prompt like one. It also now returns whether the join actually succeeded,
so `joinGroupFromUrl` can correctly fall back to the normal silent
reconnect if it didn't (wrong PIN, no connection, or a declined switch to a
genuinely different group) — a bug previously left the device unjoined in
exactly that case.

- `groups/{sha256(normalized name)}` — one document per group, whole-state
  (categories + months + `currentMonthId`), last-write-wins. `currentMonthId`
  is synced too, deliberately — a shared budget should have everyone adding
  to the same period by default, not fragmenting silently per device.
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
