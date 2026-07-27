# Money

## Overview

PWA to track expenditure by category.

Self-contained, no backend — data lives in localStorage on the device.

The header is `position: sticky` so it stays visible while a screen's
content scrolls beneath it (History, Categories, and Summary can all get
long). It's just the static "Money" wordmark plus the share icon — an
earlier iteration turned it into a live current-period-plus-total display,
but that was reverted; period context now lives in each screen's own picker
instead (see Home, List, Summary below).

The version string lives at the bottom of the bottom nav (`.bottom-nav` is a
column: the row of tab buttons, then a centered version caption beneath),
not in the header.

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
single source of truth for which period is *current*: shown in the header,
badged in Periods, and the default selection everywhere a period picker
appears (Home, List, Summary). It's settable explicitly to any period from
the Periods tab. It is a default, not a lock — Home and List each have their
own period picker and can view (and, on Home, add a spend into) any period,
not only the current one. A fresh install starts with `months: []` and
`currentMonthId: null` — there is no auto-created default period, and zero
periods is a perfectly normal ongoing state (e.g. after deleting the last
one), not just a transient first-run one. Categories are global and shared
across months, each with an optional monthly `budget` (0 = none set).

`loadData()` migrates pre-`currentMonthId` saves: the old convention (the
month with `endedAt === null`, or failing that the last one) becomes the new
`currentMonthId`, so nobody's "current period" silently changes on upgrade.

## Functions

Bottom nav, four screens (icon + label, like the `rehearsal` app). The "Home"
tab is what used to be a separate Categories screen — the old picker+amount
spend-entry form is gone entirely, replaced by adding spends straight from
each category's card (see below).

### Home (formerly Categories)
A "Period" picker (`homeMonthPicker`, same dropdown-trigger pattern as
everywhere else) sets which period this screen is viewing — defaults to the
current period but can be switched to any other, independently of what's
actually current. It resets back to current every time you navigate to the
Home tab (`switchToView` forces `homeMonthId = currentMonth()?.id` on entry)
— so switching away and back always lands you back on the current period
rather than wherever you last left it; List and Summary's own pickers do the
same on their tabs. Every card on the page (totals, the "+" add-spend icon)
reflects whichever period is picked here, and adding a spend writes into
*that* period, not necessarily `currentMonthId` — e.g. you can switch to a
past period on Home and log a spend directly into it. The picker still shows
"No periods yet" and every card just reads £0.00 spent when
`data.months.length === 0`; category management (add, rename, delete,
budget) works regardless — it never required a period to exist before this
merge and still doesn't.

Each category renders as its own large card (`.category-card`): name and
action icons on top, then the viewed period's spend total in large type —
colored against that category's budget via `budgetColorClass` (green
at/under, amber up to 10% over, red beyond; no color when no budget is set)
— a thin progress bar beneath it (only shown once a budget is set), and the
monthly budget input on its own row at the bottom. Editing the budget
re-renders the whole view (`renderCategoriesView` re-runs after
`setCategoryBudget`, not just once on open), so the total's color and the
progress bar can't go stale while you're editing.

The category name is tap-to-edit in place (`makeCategoryNameEditable`) —
clicking it swaps the name for a text input, saving on blur or Enter
(Escape reverts without saving) and re-rendering; there's no separate
rename dialog. Spends reference categories by id, not by a copied name
string, so every spend everywhere picks up the new name automatically —
nothing to cascade or migrate.

The "+" icon (`openAddCategorySpendDialog`) adds a spend straight to that
card's category — a small dialog naming the category asks only for an
amount, then calls `addSpend(homeMonthId, categoryId, amount)` plus the same
chime/toast Home's old form used. It's hidden when there's no period to add
to (`data.months.length === 0`), since a spend always needs a month to
belong to.

A bin icon (`deleteCategory`, confirmed) only appears when `categoryInUse`
is false — checked across *every* period, not just the one being viewed,
since a category deleted while in use elsewhere would leave orphaned
`categoryId` references. Reassign or edit away any spends still using it
first (List's Edit spend or bulk Reassign) and the icon appears once none
remain.

A "Total" card sits first in the list, same layout as a category card
(spend-this-period total colored against the summed budget, progress bar)
but built by hand rather than from a real category: no action icons (there's
nothing to rename, delete, or add a spend to), and the monthly budget row
shows the summed budget as plain text, not an editable input — you edit each
category's own budget, never a derived total.

"+ Add category" (name + optional monthly budget together, one step) sits
at the *bottom* of the list, below every card — this is the only way to
create a category, there's no quick-add elsewhere.

### List (history view)
Its own "Period" picker (`historyMonthPicker`, same pattern as Home/Summary,
defaults to current and resets to current every time you navigate to this
tab) sets which period's spends are shown — independent of Home's picker
and of `currentMonthId`. A "Filter by category" dropdown (same
expandable-list pattern, with an "All categories" option) narrows the list
further. The viewed period's recorded spends: date is editable inline,
pencil icon opens Edit spend (category + amount, via
`openEditSpendDialog`/`updateSpend` — category picker is the same
dropdown-trigger pattern, sourced live from `data.categories`), bin icon
deletes (confirmed). Shows a "no periods yet" prompt if `data.months.length
=== 0`.

While filtered to one category, a "Reassign to category" button appears
(hidden when showing "All categories", when the filtered category has no
spends in the viewed period, or when there's no other category to move them
to). Opens a dialog naming the count and source category, picks a target
from a dropdown that excludes the source, and `reassignCategory` moves every
matching spend *in the viewed period only* in one action — the filter then
follows the moved spends to the target category, so the result is visible
immediately. This is the bulk counterpart to Edit spend's one-at-a-time
category change.

### Summary (report view)
Empty state if there are no periods at all (`data.months.length === 0`) —
otherwise, choose a period (default: current; also resets to current every
time you navigate to this tab, like Home and List). A compact CSS-grid table
(`.breakdown-header` + one `.breakdown-item` `<li>` per category, union of
both periods' categories, sorted by main-period spend): category name,
current-period amount, compare-period amount, budget, all on one row. Grid
columns are `1fr 76px 76px 60px` (collapsing to `1fr 76px 60px` via
`.breakdown-wrapper.no-compare` when there's no compare period — the
compare header label and footer total are `.hidden`-toggled rather than
just emptied, so they drop out of the grid instead of leaving a blank
column), so the header row's period-name labels line up with the amount
columns beneath them without repeating a label per row.

Current/compare amounts are colored relative to that category's `budget`
(`budgetColorClass`): green at or under budget, amber up to 10% over, red
beyond that; no color (default text) when the category has no budget set.
Current and compare are colored independently against the same budget. The
budget column itself (`.breakdown-cat-budget`) is small and muted — it's
reference context, not the headline numbers — showing "—" when unset. A
category with spend in only one of the two periods still gets a value in
both amount columns — the other just shows £0.00.

A `.breakdown-footer` row sums each column (current/compare/budget, over
just the categories shown — i.e. the ones with spend in either period, not
every category that exists) and replaces the old standalone period-total
figure above the table entirely; showing the same number twice (once big
above, once in the table) was redundant once the table carried its own
totals row. Hidden along with the rest of the table when there's nothing to
show. No bars, no share-of-total percentage, no change line — the numbers
side by side already show status and direction of change without needing
any of that spelled out.

A second picker ("Compare with") sets which period that second column is —
defaults to whatever's immediately before the main period chronologically
(by array/`startedAt` order, unrelated to `currentMonthId`), but the user can
pick any other period instead, or `NO_COMPARE` ("None") to show just the main
period with no second column at all. Its list excludes the main period
(comparing a period to itself isn't useful) and only resets to the default
when the current choice becomes invalid (main period changed to match it, or
it no longer exists) — switching the main period otherwise keeps an explicit
comparison choice, including an explicit "None".

This is purely a *viewing* picker, entirely independent of Home's and
List's own period pickers and of `currentMonthId` — three screens, three
independent "which period" choices, all defaulting to current until changed.

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
  period except the current one. Changes `currentMonthId` — the default
  period Home, List, and Summary's pickers all start on — entirely decoupled
  from creation order or which period any of them happens to be viewing at
  the time.
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
