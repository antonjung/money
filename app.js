const APP_VERSION = 'v3.5';

// ── Sound ─────────────────────────────────────────────────────────────────────

let audioCtx = null;

// Soft two-note chime (C5 then E5) confirming a spend was added — gentle
// attack/decay rather than a sharp arcade-blip sweep. Created lazily inside
// a user-gesture handler (the add-spend dialog's confirm button) to satisfy
// autoplay policies.
function playAddedSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [523.25, 659.25].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // Web Audio unavailable/blocked — the sound is a nice-to-have, skip silently.
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'money-data';
const GROUP_STORAGE_KEY = 'money-group';

function loadData() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
  if (!data || !Array.isArray(data.months)) {
    data = { categories: [], months: [], currentMonthId: null };
  }
  // Migrate data saved before currentMonthId existed: the old convention was
  // "current = the one with no endedAt, or failing that the last one".
  if (data.currentMonthId === undefined) {
    const legacyOpen = data.months.find(m => m.endedAt === null) || data.months[data.months.length - 1];
    data.currentMonthId = legacyOpen ? legacyOpen.id : null;
  }
  return data;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  maybeSyncToGroup();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayISODate() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const data = loadData();

function currentMonth() {
  return data.months.find(m => m.id === data.currentMonthId) || null;
}

// ── Categories ────────────────────────────────────────────────────────────────

function findCategory(id) {
  return data.categories.find(c => c.id === id);
}

function addCategory(name) {
  name = name.trim();
  if (!name) return null;
  const existing = data.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const cat = { id: uid(), name, budget: 0 };
  data.categories.push(cat);
  saveData();
  return cat;
}

function setCategoryBudget(categoryId, budget) {
  const cat = findCategory(categoryId);
  if (!cat) return;
  cat.budget = budget;
  saveData();
}

// Spends reference categories by id, not name, so renaming here is all
// that's needed — every spend already shows whatever the category is
// currently called, nothing to update on the spends themselves.
function renameCategory(categoryId, newName) {
  const cat = findCategory(categoryId);
  if (!cat) return;
  newName = (newName || '').trim();
  if (!newName) return;
  cat.name = newName;
  saveData();
}

// True if any spend in any period (not just the current one) references
// this category — used to only offer deletion when it's actually safe.
function categoryInUse(categoryId) {
  return data.months.some(m => m.spends.some(s => s.categoryId === categoryId));
}

function deleteCategory(categoryId) {
  const idx = data.categories.findIndex(c => c.id === categoryId);
  if (idx === -1) return;
  data.categories.splice(idx, 1);
  saveData();
}

// ── Spends ────────────────────────────────────────────────────────────────────

function addSpend(monthId, categoryId, amount) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return;
  month.spends.push({ id: uid(), categoryId, amount, note: '', at: todayISODate() });
  saveData();
}

function deleteSpend(monthId, spendId) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return;
  month.spends = month.spends.filter(s => s.id !== spendId);
  saveData();
}

function updateSpendDate(monthId, spendId, newDate) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return;
  const spend = month.spends.find(s => s.id === spendId);
  if (!spend) return;
  spend.at = newDate;
  saveData();
}

function updateSpend(monthId, spendId, categoryId, amount) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return;
  const spend = month.spends.find(s => s.id === spendId);
  if (!spend) return;
  spend.categoryId = categoryId;
  spend.amount = amount;
  saveData();
}

// Moves every spend in one month from one category to another — used to
// bulk-reassign a filtered category's spends in List rather than editing
// them one at a time.
function reassignCategory(monthId, fromCategoryId, toCategoryId) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return 0;
  let count = 0;
  for (const s of month.spends) {
    if (s.categoryId === fromCategoryId) {
      s.categoryId = toCategoryId;
      count++;
    }
  }
  if (count > 0) saveData();
  return count;
}

function monthTotal(month) {
  return month.spends.reduce((sum, s) => sum + s.amount, 0);
}

function categoryTotals(month) {
  const map = new Map();
  for (const s of month.spends) {
    map.set(s.categoryId, (map.get(s.categoryId) || 0) + s.amount);
  }
  return map;
}

// Creates a period but doesn't switch to it (see setCurrentMonth) — except
// the very first period ever, which becomes current automatically since
// there'd otherwise be no way to add a spend without an extra manual step.
function addPeriod(label) {
  label = (label || '').trim();
  if (!label) return null;
  const month = { id: uid(), label, startedAt: new Date().toISOString(), spends: [] };
  data.months.push(month);
  if (!data.currentMonthId) data.currentMonthId = month.id;
  saveData();
  return month;
}

function setCurrentMonth(monthId) {
  if (!data.months.some(m => m.id === monthId)) return;
  data.currentMonthId = monthId;
  saveData();
}

function renameMonth(monthId, newLabel) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return;
  newLabel = (newLabel || '').trim();
  if (!newLabel) return;
  month.label = newLabel;
  saveData();
}

function deleteMonth(monthId) {
  const idx = data.months.findIndex(m => m.id === monthId);
  if (idx === -1) return;
  data.months.splice(idx, 1);
  if (data.currentMonthId === monthId) {
    // Fall back to whatever period was created most recently, if any — the
    // app is fine with zero periods (same as a fresh install).
    data.currentMonthId = data.months.length ? data.months[data.months.length - 1].id : null;
  }
  saveData();
}

// ── Formatting ────────────────────────────────────────────────────────────────

function money(n) {
  return '£' + n.toFixed(2);
}

// ── Group sharing ─────────────────────────────────────────────────────────────
// Data is shared with anyone using the same group name + PIN. The group name
// (normalized, hashed) picks a single Firestore document; the actual content
// is AES-GCM encrypted with a key derived (PBKDF2) from name + PIN, so Firestore
// rules can stay open — a reader without the right PIN just gets ciphertext.
// One document per group, whole-state, last-write-wins (fine at this data size).

function normalizeGroupName(name) {
  return name.trim().toLowerCase();
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const groupKeyCache = new Map();
function deriveGroupKey(name, pin) {
  const cacheKey = normalizeGroupName(name) + ' ' + pin;
  let cached = groupKeyCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(normalizeGroupName(name)), iterations: 100_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    groupKeyCache.set(cacheKey, cached);
  }
  return cached;
}

async function encryptForGroup(obj, key) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { ciphertext: toBase64Url(ciphertext), iv: toBase64Url(iv) };
}

async function decryptFromGroup(docData, key) {
  const ciphertext = fromBase64Url(docData.ciphertext);
  const iv = fromBase64Url(docData.iv);
  const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function firebaseConfigured() {
  return !!(window.firebaseConfig && window.firebaseConfig.apiKey);
}

function loadFirebaseScripts() {
  if (window.firebase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s1 = document.createElement('script');
    s1.src = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js';
    s1.onerror = reject;
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js';
      s2.onload = resolve;
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
  });
}

let firestoreDb = null;
function ensureFirestore() {
  if (!firestoreDb) {
    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    firestoreDb = firebase.firestore();
  }
  return firestoreDb;
}

let activeGroup = null; // { name, pin, id, key, ref, unsubscribe }
let applyingRemote = false;
let lastGroupSignature = null;

function dataSignature() {
  return JSON.stringify({ categories: data.categories, months: data.months, currentMonthId: data.currentMonthId });
}

function setGroupStatus(text, cls) {
  const el = document.getElementById('groupStatus');
  el.textContent = text;
  el.className = 'group-status' + (cls ? ' ' + cls : '');
}

function updateGroupUI() {
  const joinForm = document.getElementById('groupJoinForm');
  const leaveBtn = document.getElementById('leaveGroupBtn');
  const inviteBtn = document.getElementById('inviteGroupBtn');
  if (activeGroup) {
    joinForm.classList.add('hidden');
    leaveBtn.classList.remove('hidden');
    inviteBtn.classList.remove('hidden');
    setGroupStatus(`Shared as "${activeGroup.name}"`, 'active');
  } else {
    joinForm.classList.remove('hidden');
    leaveBtn.classList.add('hidden');
    inviteBtn.classList.add('hidden');
    setGroupStatus('Not shared — data stays on this device.');
  }
}

function buildInviteUrl() {
  return `${location.origin}${location.pathname}#group=${encodeURIComponent(activeGroup.name)}&pin=${encodeURIComponent(activeGroup.pin)}`;
}

async function inviteToGroup() {
  if (!activeGroup) return;
  const url = buildInviteUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Money', text: `Join "${activeGroup.name}" on Money`, url });
    } catch {
      // User cancelled the share sheet, or sharing isn't actually supported despite the
      // feature check — either way they've already seen a native UI, so no fallback here.
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    setGroupStatus('Invite link copied to clipboard.', 'active');
  } catch {
    setGroupStatus('Could not copy the invite link.', 'error');
  }
}

async function pushGroupData() {
  if (!activeGroup) return;
  const sig = dataSignature();
  const payload = { v: 1, categories: data.categories, months: data.months, currentMonthId: data.currentMonthId };
  const enc = await encryptForGroup(payload, activeGroup.key);
  lastGroupSignature = sig;
  await activeGroup.ref.set({ ciphertext: enc.ciphertext, iv: enc.iv, v: 1, updatedAt: Date.now() });
}

function maybeSyncToGroup() {
  if (!activeGroup || applyingRemote) return;
  pushGroupData().catch(() => setGroupStatus('Sync failed — will retry on next change.', 'error'));
}

function applyIncomingGroupDoc(decoded) {
  const sig = JSON.stringify({ categories: decoded.categories, months: decoded.months, currentMonthId: decoded.currentMonthId });
  if (sig === lastGroupSignature) return; // our own write echoing back
  lastGroupSignature = sig;
  applyingRemote = true;
  data.categories = decoded.categories || [];
  data.months = decoded.months && decoded.months.length ? decoded.months : data.months;
  data.currentMonthId = decoded.currentMonthId !== undefined ? decoded.currentMonthId : data.currentMonthId;
  saveData();
  applyingRemote = false;
  renderAll();
}

function startGroupListener() {
  activeGroup.unsubscribe = activeGroup.ref.onSnapshot(async snap => {
    if (!snap.exists) return;
    try {
      const decoded = await decryptFromGroup(snap.data(), activeGroup.key);
      applyIncomingGroupDoc(decoded);
    } catch {
      // Ignore — a bad decrypt here would mean the PIN changed mid-session, which
      // isn't a supported flow; joining fresh with the new PIN is the recovery path.
    }
  });
}

async function joinGroup(name, pin, { silent = false } = {}) {
  name = name.trim();
  pin = pin.trim();
  if (!name || !pin) { setGroupStatus('Enter a group name and PIN.', 'error'); return false; }
  if (!firebaseConfigured()) { setGroupStatus('Sharing is not configured for this app.', 'error'); return false; }

  // Reconnecting to the group this device is already configured for (e.g. via
  // its own invite link, or a silent reconnect on load) isn't a *switch* —
  // don't warn about replacing data, there's nothing being replaced with
  // anything different. Only genuinely joining a different group needs that.
  let alreadyThisGroup = false;
  try {
    const saved = JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY));
    alreadyThisGroup = !!saved && normalizeGroupName(saved.name) === normalizeGroupName(name);
  } catch {}

  if (!silent) setGroupStatus('Connecting…');
  try {
    await loadFirebaseScripts();
    ensureFirestore();
    const id = await sha256Hex(normalizeGroupName(name));
    const key = await deriveGroupKey(name, pin);
    const ref = firestoreDb.collection('groups').doc(id);
    const snap = await ref.get();

    if (snap.exists) {
      let decoded;
      try {
        decoded = await decryptFromGroup(snap.data(), key);
      } catch {
        setGroupStatus('Wrong group name or PIN.', 'error');
        return false;
      }
      const hasLocalContent = data.categories.length || data.months.some(m => m.spends.length);
      if (!silent && !alreadyThisGroup && hasLocalContent && !confirm(`Joining "${name}" replaces this device's data with the group's shared data. Continue?`)) {
        setGroupStatus('Not shared — data stays on this device.');
        return false;
      }
      data.categories = decoded.categories || [];
      data.months = decoded.months && decoded.months.length ? decoded.months : data.months;
      data.currentMonthId = decoded.currentMonthId !== undefined ? decoded.currentMonthId : data.currentMonthId;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      lastGroupSignature = dataSignature();
    }

    activeGroup = { name, pin, id, key, ref, unsubscribe: null };
    localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify({ name, pin }));

    if (!snap.exists) await pushGroupData();

    startGroupListener();
    updateGroupUI();
    renderAll();
    return true;
  } catch (err) {
    setGroupStatus('Could not connect — check your connection and try again.', 'error');
    return false;
  }
}

function leaveGroup() {
  if (activeGroup?.unsubscribe) activeGroup.unsubscribe();
  activeGroup = null;
  lastGroupSignature = null;
  localStorage.removeItem(GROUP_STORAGE_KEY);
  updateGroupUI();
}

async function initGroupFromStorage() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY)); } catch {}
  if (!saved?.name || !saved?.pin) return;
  await joinGroup(saved.name, saved.pin, { silent: true });
}

// Picks up group + PIN from an invite link, e.g. .../#group=X&pin=Y (see
// buildInviteUrl/inviteToGroup). Returns whether it actually joined, so init
// can fall back to the normal silent reconnect if this didn't work out
// (wrong PIN, no connection, or the user declined replacing local data).
async function joinGroupFromUrl() {
  const match = location.hash.match(/^#group=([^&]+)&pin=([^&]+)$/);
  if (!match) return false;
  history.replaceState(null, '', location.pathname + location.search);
  return await joinGroup(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
}

// ── Elements ──────────────────────────────────────────────────────────────────

const BIN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const PENCIL_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>';
const PLUS_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const tabs = document.querySelectorAll('.nav-tab[data-view]');
const goToCurrentBtn = document.getElementById('goToCurrentBtn');
const spendView = document.getElementById('spendView');
const historyView = document.getElementById('historyView');
const reportView = document.getElementById('reportView');
const periodsView = document.getElementById('periodsView');

const homeMonthTrigger = document.getElementById('homeMonthTrigger');
const homeMonthTriggerLabel = document.getElementById('homeMonthTriggerLabel');
const homeMonthDropdown = document.getElementById('homeMonthDropdown');

const historyMonthTrigger = document.getElementById('historyMonthTrigger');
const historyMonthTriggerLabel = document.getElementById('historyMonthTriggerLabel');
const historyMonthDropdown = document.getElementById('historyMonthDropdown');
const historyFilterTrigger = document.getElementById('historyFilterTrigger');
const historyFilterTriggerLabel = document.getElementById('historyFilterTriggerLabel');
const historyFilterDropdown = document.getElementById('historyFilterDropdown');
const reassignCategoryBtn = document.getElementById('reassignCategoryBtn');
const spendList = document.getElementById('spendList');

const reassignCategoryDialog = document.getElementById('reassignCategoryDialog');
const reassignCategoryMessage = document.getElementById('reassignCategoryMessage');
const reassignCategoryTrigger = document.getElementById('reassignCategoryTrigger');
const reassignCategoryTriggerLabel = document.getElementById('reassignCategoryTriggerLabel');
const reassignCategoryDropdown = document.getElementById('reassignCategoryDropdown');
const reassignCategoryCancelBtn = document.getElementById('reassignCategoryCancelBtn');
const reassignCategoryConfirmBtn = document.getElementById('reassignCategoryConfirmBtn');

const editSpendDialog = document.getElementById('editSpendDialog');
const editSpendCategoryTrigger = document.getElementById('editSpendCategoryTrigger');
const editSpendCategoryTriggerLabel = document.getElementById('editSpendCategoryTriggerLabel');
const editSpendCategoryDropdown = document.getElementById('editSpendCategoryDropdown');
const editSpendAmountInput = document.getElementById('editSpendAmountInput');
const editSpendCancelBtn = document.getElementById('editSpendCancelBtn');
const editSpendConfirmBtn = document.getElementById('editSpendConfirmBtn');

const noPeriodsMsg = document.getElementById('noPeriodsMsg');
const reportGoToPeriodsBtn = document.getElementById('reportGoToPeriodsBtn');
const reportContent = document.getElementById('reportContent');
const monthTrigger = document.getElementById('monthTrigger');
const monthTriggerLabel = document.getElementById('monthTriggerLabel');
const monthDropdown = document.getElementById('monthDropdown');
const compareMonthTrigger = document.getElementById('compareMonthTrigger');
const compareMonthTriggerLabel = document.getElementById('compareMonthTriggerLabel');
const compareMonthDropdown = document.getElementById('compareMonthDropdown');
const breakdownWrapper = document.getElementById('breakdownWrapper');
const breakdownMainLabel = document.getElementById('breakdownMainLabel');
const breakdownCompareLabel = document.getElementById('breakdownCompareLabel');
const breakdownFooter = document.getElementById('breakdownFooter');
const breakdownTotalCurrent = document.getElementById('breakdownTotalCurrent');
const breakdownTotalCompare = document.getElementById('breakdownTotalCompare');
const breakdownTotalBudget = document.getElementById('breakdownTotalBudget');
const categoryBreakdown = document.getElementById('categoryBreakdown');

const categoryList = document.getElementById('categoryList');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const addCategoryDialog = document.getElementById('addCategoryDialog');
const newCategoryNameInput = document.getElementById('newCategoryNameInput');
const newCategoryBudgetInput = document.getElementById('newCategoryBudgetInput');
const addCategoryCancelBtn = document.getElementById('addCategoryCancelBtn');
const addCategoryConfirmBtn = document.getElementById('addCategoryConfirmBtn');

const addCategorySpendDialog = document.getElementById('addCategorySpendDialog');
const addCategorySpendLabel = document.getElementById('addCategorySpendLabel');
const addCategorySpendAmountInput = document.getElementById('addCategorySpendAmountInput');
const addCategorySpendCancelBtn = document.getElementById('addCategorySpendCancelBtn');
const addCategorySpendConfirmBtn = document.getElementById('addCategorySpendConfirmBtn');

const periodList = document.getElementById('periodList');
const addPeriodBtn = document.getElementById('addPeriodBtn');
const addPeriodDialog = document.getElementById('addPeriodDialog');
const newPeriodNameInput = document.getElementById('newPeriodNameInput');
const addPeriodCancelBtn = document.getElementById('addPeriodCancelBtn');
const addPeriodConfirmBtn = document.getElementById('addPeriodConfirmBtn');

const renameMonthDialog = document.getElementById('renameMonthDialog');
const renameMonthInput = document.getElementById('renameMonthInput');
const renameMonthCancelBtn = document.getElementById('renameMonthCancelBtn');
const renameMonthConfirmBtn = document.getElementById('renameMonthConfirmBtn');

const shareBtn = document.getElementById('shareBtn');
const shareDialog = document.getElementById('shareDialog');
const closeShareBtn = document.getElementById('closeShareBtn');
const groupNameInput = document.getElementById('groupNameInput');
const groupPinInput = document.getElementById('groupPinInput');
const joinGroupBtn = document.getElementById('joinGroupBtn');
const inviteGroupBtn = document.getElementById('inviteGroupBtn');
const leaveGroupBtn = document.getElementById('leaveGroupBtn');

const confirmDialog = document.getElementById('confirmDialog');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmOkBtn = document.getElementById('confirmOkBtn');

let pendingConfirmAction = null;
let pendingCancelAction = null;

// `options.okLabel`/`okClass` let non-destructive warnings (e.g. "not the
// current period") use a neutral button instead of the default red
// "Confirm", which is meant for actually-destructive actions like delete.
function openConfirm(title, message, action, options = {}) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmOkBtn.textContent = options.okLabel || 'Confirm';
  confirmOkBtn.className = 'btn ' + (options.okClass || 'btn-danger');
  pendingConfirmAction = action;
  pendingCancelAction = options.onCancel || null;
  confirmDialog.showModal();
}

confirmCancelBtn.addEventListener('click', () => {
  const cancelAction = pendingCancelAction;
  pendingConfirmAction = null;
  pendingCancelAction = null;
  confirmDialog.close();
  if (cancelAction) cancelAction();
});

confirmOkBtn.addEventListener('click', () => {
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  pendingCancelAction = null;
  confirmDialog.close();
  if (action) action();
});

// Warns before adding, updating, or deleting a spend in a period that
// isn't the actual current one — Home/List let you view and act on any
// period, so it's easy to change history by accident while browsing it.
// Runs `action` straight away (no dialog) when the period IS current.
function confirmNonCurrentPeriod(monthId, message, action, onCancel) {
  if (!monthId || monthId === data.currentMonthId) {
    action();
    return;
  }
  const month = data.months.find(m => m.id === monthId);
  openConfirm(
    'Not the current period',
    `${message} "${month ? month.label : 'This period'}" isn't the current period. Continue?`,
    action,
    { okLabel: 'Continue', okClass: 'btn-primary', onCancel },
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchToView(view) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
  spendView.classList.toggle('hidden', view !== 'spend');
  historyView.classList.toggle('hidden', view !== 'history');
  reportView.classList.toggle('hidden', view !== 'report');
  periodsView.classList.toggle('hidden', view !== 'periods');
  if (view === 'spend') renderCategoriesView();
  if (view === 'history') renderHistoryView();
  if (view === 'report') renderReport();
  if (view === 'periods') renderPeriodsView();
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => switchToView(tab.dataset.view));
});

reportGoToPeriodsBtn.addEventListener('click', () => switchToView('periods'));

// Snaps every screen's own period picker (Home, List, Summary) back to the
// current period in one action — each picker otherwise keeps whatever was
// last viewed independently, so this is the fast way back after browsing.
goToCurrentBtn.addEventListener('click', () => {
  const id = currentMonth()?.id ?? null;
  homeMonthId = id;
  historyMonthId = id;
  selectedMonthId = id;
  renderMoneyViews();
});

// ── Period pickers (Home, List) ──────────────────────────────────────────────
// Both Home and List let you view (and, for Home, add spends into) any
// period, not just the current one — same dropdown-trigger pattern Summary's
// period picker uses, defaulting to the current period until the user picks
// something else.

function createPeriodPicker({ trigger, dropdown, label, getSelected, setSelected, onChange }) {
  function close() {
    dropdown.classList.add('hidden');
    trigger.classList.remove('open');
  }
  function toggle() {
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) close();
    else {
      dropdown.classList.remove('hidden');
      trigger.classList.add('open');
    }
  }
  trigger.addEventListener('click', toggle);

  function render() {
    const sorted = [...data.months].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    let selected = getSelected();
    if (!sorted.some(m => m.id === selected)) {
      selected = currentMonth()?.id ?? sorted[0]?.id ?? null;
      setSelected(selected);
    }

    dropdown.innerHTML = '';
    label.textContent = sorted.length ? 'Select period' : 'No periods yet';
    for (const m of sorted) {
      if (m.id === selected) label.textContent = m.label;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-item' + (m.id === selected ? ' selected' : '');
      item.textContent = m.label;
      item.addEventListener('click', () => {
        setSelected(m.id);
        close();
        onChange();
      });
      dropdown.appendChild(item);
    }
    // A visual nudge when viewing anything other than the current period —
    // easy to lose track of since Home/List let you view (and act on) any
    // period.
    trigger.classList.toggle('non-current', !!selected && selected !== data.currentMonthId);
    return sorted;
  }

  return { render };
}

let homeMonthId = null;
const homeMonthPicker = createPeriodPicker({
  trigger: homeMonthTrigger,
  dropdown: homeMonthDropdown,
  label: homeMonthTriggerLabel,
  getSelected: () => homeMonthId,
  setSelected: id => { homeMonthId = id; },
  onChange: renderCategoriesView,
});

let historyMonthId = null;
const historyMonthPicker = createPeriodPicker({
  trigger: historyMonthTrigger,
  dropdown: historyMonthDropdown,
  label: historyMonthTriggerLabel,
  getSelected: () => historyMonthId,
  setSelected: id => { historyMonthId = id; },
  onChange: renderHistoryView,
});

let historyFilterCategoryId = null; // null = all categories

function closeHistoryFilterDropdown() {
  historyFilterDropdown.classList.add('hidden');
  historyFilterTrigger.classList.remove('open');
}

function toggleHistoryFilterDropdown() {
  const isOpen = !historyFilterDropdown.classList.contains('hidden');
  if (isOpen) closeHistoryFilterDropdown();
  else {
    historyFilterDropdown.classList.remove('hidden');
    historyFilterTrigger.classList.add('open');
  }
}

historyFilterTrigger.addEventListener('click', toggleHistoryFilterDropdown);

function selectHistoryFilter(categoryId) {
  historyFilterCategoryId = categoryId;
  closeHistoryFilterDropdown();
  renderHistoryView();
}

function renderHistoryFilterDropdown() {
  const sorted = [...data.categories].sort((a, b) => a.name.localeCompare(b.name));
  historyFilterDropdown.innerHTML = '';

  const allItem = document.createElement('button');
  allItem.type = 'button';
  allItem.className = 'dropdown-item' + (!historyFilterCategoryId ? ' selected' : '');
  allItem.textContent = 'All categories';
  allItem.addEventListener('click', () => selectHistoryFilter(null));
  historyFilterDropdown.appendChild(allItem);

  for (const cat of sorted) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item' + (cat.id === historyFilterCategoryId ? ' selected' : '');
    item.textContent = cat.name;
    item.addEventListener('click', () => selectHistoryFilter(cat.id));
    historyFilterDropdown.appendChild(item);
  }

  const selectedCat = historyFilterCategoryId ? findCategory(historyFilterCategoryId) : null;
  historyFilterTriggerLabel.textContent = selectedCat ? selectedCat.name : 'All categories';
}

function renderHistoryView() {
  historyMonthPicker.render();
  const month = data.months.find(m => m.id === historyMonthId) || null;
  if (!month) {
    reassignCategoryBtn.classList.add('hidden');
    spendList.innerHTML = '<li class="empty-msg">No periods yet. Add one from the Periods tab.</li>';
    return;
  }

  renderHistoryFilterDropdown();

  const filtered = historyFilterCategoryId
    ? month.spends.filter(s => s.categoryId === historyFilterCategoryId)
    : month.spends;

  reassignCategoryBtn.classList.toggle('hidden', !(historyFilterCategoryId && filtered.length > 0 && data.categories.length > 1));

  spendList.innerHTML = '';
  if (!filtered.length) {
    spendList.innerHTML = month.spends.length
      ? '<li class="empty-msg">No spends in this category.</li>'
      : '<li class="empty-msg">No spends recorded yet this period.</li>';
    return;
  }
  const sorted = [...filtered].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  for (const s of sorted) {
    const cat = findCategory(s.categoryId);
    const li = document.createElement('li');
    li.className = 'spend-item';
    li.innerHTML = `
      <div class="spend-main">
        <div class="spend-category">${escapeHtml(cat ? cat.name : 'Unknown')}</div>
        <div class="spend-meta">
          <input type="date" class="spend-date-input" value="${s.at.slice(0, 10)}">
          ${s.note ? `<span class="spend-note">· ${escapeHtml(s.note)}</span>` : ''}
        </div>
      </div>
      <div class="spend-amount">${money(s.amount)}</div>
      <button class="spend-edit" aria-label="Edit">${PENCIL_ICON_SVG}</button>
      <button class="spend-delete" aria-label="Delete">${BIN_ICON_SVG}</button>
    `;
    li.querySelector('.spend-date-input').addEventListener('change', e => {
      const newDate = e.target.value || todayISODate();
      confirmNonCurrentPeriod(
        month.id,
        "Updating this spend's date.",
        () => { updateSpendDate(month.id, s.id, newDate); renderHistoryView(); },
        () => renderHistoryView(),
      );
    });
    li.querySelector('.spend-edit').addEventListener('click', () => openEditSpendDialog(month.id, s.id));
    li.querySelector('.spend-delete').addEventListener('click', () => {
      const notCurrent = month.id !== data.currentMonthId;
      openConfirm(
        'Delete spend?',
        `Delete this ${money(s.amount)} spend${cat ? ' in ' + cat.name : ''}? This can't be undone.${notCurrent ? ` "${month.label}" isn't the current period.` : ''}`,
        () => { deleteSpend(month.id, s.id); renderAll(); },
      );
    });
    spendList.appendChild(li);
  }
}

// ── Reassign category ─────────────────────────────────────────────────────────
// Bulk-moves every spend currently shown by the List filter to a different
// category, in one action — only available while filtered to one category.

let reassignSelectedCategoryId = null;

function closeReassignCategoryDropdown() {
  reassignCategoryDropdown.classList.add('hidden');
  reassignCategoryTrigger.classList.remove('open');
}

function toggleReassignCategoryDropdown() {
  const isOpen = !reassignCategoryDropdown.classList.contains('hidden');
  if (isOpen) closeReassignCategoryDropdown();
  else {
    reassignCategoryDropdown.classList.remove('hidden');
    reassignCategoryTrigger.classList.add('open');
  }
}

reassignCategoryTrigger.addEventListener('click', toggleReassignCategoryDropdown);

function renderReassignCategoryDropdown() {
  const sorted = [...data.categories]
    .filter(c => c.id !== historyFilterCategoryId)
    .sort((a, b) => a.name.localeCompare(b.name));
  reassignCategoryDropdown.innerHTML = '';
  for (const cat of sorted) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item' + (cat.id === reassignSelectedCategoryId ? ' selected' : '');
    item.textContent = cat.name;
    item.addEventListener('click', () => {
      reassignSelectedCategoryId = cat.id;
      closeReassignCategoryDropdown();
      renderReassignCategoryDropdown();
      reassignCategoryTriggerLabel.textContent = cat.name;
    });
    reassignCategoryDropdown.appendChild(item);
  }
}

reassignCategoryBtn.addEventListener('click', () => {
  const month = data.months.find(m => m.id === historyMonthId) || null;
  if (!month || !historyFilterCategoryId) return;
  const count = month.spends.filter(s => s.categoryId === historyFilterCategoryId).length;
  const fromCat = findCategory(historyFilterCategoryId);
  const notCurrent = month.id !== data.currentMonthId;
  reassignCategoryMessage.textContent = `Move ${count} spend${count === 1 ? '' : 's'} in "${fromCat ? fromCat.name : 'this category'}" to:${notCurrent ? ` "${month.label}" isn't the current period.` : ''}`;
  reassignSelectedCategoryId = null;
  reassignCategoryTriggerLabel.textContent = 'Select category';
  renderReassignCategoryDropdown();
  reassignCategoryDialog.showModal();
});

reassignCategoryCancelBtn.addEventListener('click', () => reassignCategoryDialog.close());

reassignCategoryConfirmBtn.addEventListener('click', () => {
  const month = data.months.find(m => m.id === historyMonthId) || null;
  if (!month || !historyFilterCategoryId || !reassignSelectedCategoryId) return;
  reassignCategory(month.id, historyFilterCategoryId, reassignSelectedCategoryId);
  historyFilterCategoryId = reassignSelectedCategoryId; // follow the moved spends
  reassignCategoryDialog.close();
  renderAll();
});

// ── Edit spend ────────────────────────────────────────────────────────────────

let pendingEditSpend = null; // { monthId, spendId }
let editSpendSelectedCategoryId = null;

function closeEditSpendCategoryDropdown() {
  editSpendCategoryDropdown.classList.add('hidden');
  editSpendCategoryTrigger.classList.remove('open');
}

function toggleEditSpendCategoryDropdown() {
  const isOpen = !editSpendCategoryDropdown.classList.contains('hidden');
  if (isOpen) closeEditSpendCategoryDropdown();
  else {
    editSpendCategoryDropdown.classList.remove('hidden');
    editSpendCategoryTrigger.classList.add('open');
  }
}

editSpendCategoryTrigger.addEventListener('click', toggleEditSpendCategoryDropdown);

function renderEditSpendCategoryDropdown() {
  const sorted = [...data.categories].sort((a, b) => a.name.localeCompare(b.name));
  editSpendCategoryDropdown.innerHTML = '';
  for (const cat of sorted) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item' + (cat.id === editSpendSelectedCategoryId ? ' selected' : '');
    item.textContent = cat.name;
    item.addEventListener('click', () => {
      editSpendSelectedCategoryId = cat.id;
      closeEditSpendCategoryDropdown();
      renderEditSpendCategoryDropdown();
      editSpendCategoryTriggerLabel.textContent = cat.name;
    });
    editSpendCategoryDropdown.appendChild(item);
  }
}

function openEditSpendDialog(monthId, spendId) {
  const month = data.months.find(m => m.id === monthId);
  const spend = month?.spends.find(s => s.id === spendId);
  if (!month || !spend) return;
  pendingEditSpend = { monthId, spendId };
  editSpendSelectedCategoryId = spend.categoryId;
  const cat = findCategory(spend.categoryId);
  editSpendCategoryTriggerLabel.textContent = cat ? cat.name : 'Select category';
  editSpendAmountInput.value = spend.amount;
  renderEditSpendCategoryDropdown();
  editSpendDialog.showModal();
}

editSpendCancelBtn.addEventListener('click', () => editSpendDialog.close());

editSpendConfirmBtn.addEventListener('click', () => {
  if (!pendingEditSpend || !editSpendSelectedCategoryId) return;
  const amount = parseFloat(editSpendAmountInput.value);
  if (!amount || amount <= 0) { editSpendAmountInput.focus(); return; }
  const { monthId, spendId } = pendingEditSpend;
  editSpendDialog.close();
  confirmNonCurrentPeriod(monthId, 'Updating this spend.', () => {
    updateSpend(monthId, spendId, editSpendSelectedCategoryId, amount);
    renderAll();
  });
});

function renderMoneyViews() {
  if (!spendView.classList.contains('hidden')) renderCategoriesView();
  renderHistoryView();
  if (!reportView.classList.contains('hidden')) renderReport();
  if (!periodsView.classList.contains('hidden')) renderPeriodsView();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Categories view (also Home) ──────────────────────────────────────────────

function renderCategoriesView() {
  homeMonthPicker.render();
  const month = data.months.find(m => m.id === homeMonthId) || null;

  categoryList.innerHTML = '';
  const sorted = [...data.categories].sort((a, b) => a.name.localeCompare(b.name));

  if (!sorted.length) {
    categoryList.innerHTML = '<li class="empty-msg">No categories yet.</li>';
    return;
  }
  const spent = month ? categoryTotals(month) : new Map();

  const totalBudget = sorted.reduce((sum, c) => sum + (c.budget || 0), 0);
  const totalSpent = sorted.reduce((sum, c) => sum + (spent.get(c.id) || 0), 0);
  const totalColorClass = budgetColorClass(totalSpent, totalBudget);
  const totalPct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
  const totalLi = document.createElement('li');
  totalLi.className = 'category-card category-total-card';
  totalLi.innerHTML = `
    <div class="category-card-top">
      <span class="category-name">Total</span>
    </div>
    <div class="category-card-total ${totalColorClass}">${money(totalSpent)}</div>
    <div class="category-card-sub">spent this period</div>
    ${totalBudget > 0 ? `<div class="category-progress"><div class="category-progress-bar ${totalColorClass}" style="width:${totalPct}%"></div></div>` : ''}
    <div class="category-card-budget-row">
      <span class="muted small">Monthly budget</span>
      <span class="category-total-budget-value">${totalBudget > 0 ? money(totalBudget) : '—'}</span>
    </div>
  `;
  categoryList.appendChild(totalLi);

  for (const cat of sorted) {
    const canDelete = !categoryInUse(cat.id);
    const catSpent = spent.get(cat.id) || 0;
    const colorClass = budgetColorClass(catSpent, cat.budget);
    const pct = cat.budget > 0 ? Math.min(100, (catSpent / cat.budget) * 100) : 0;
    const li = document.createElement('li');
    li.className = 'category-card';
    li.innerHTML = `
      <div class="category-card-top">
        <span class="category-name" tabindex="0" role="button" aria-label="Edit category name">${escapeHtml(cat.name)}</span>
        <div class="category-row-actions">
          ${month ? `<button type="button" class="icon-btn-square add-category-spend-btn" aria-label="Add spend">${PLUS_ICON_SVG}</button>` : ''}
          ${canDelete ? `<button type="button" class="icon-btn-square danger delete-category-btn" aria-label="Delete category">${BIN_ICON_SVG}</button>` : ''}
        </div>
      </div>
      <div class="category-card-total ${colorClass}">${money(catSpent)}</div>
      <div class="category-card-sub">spent this period</div>
      ${cat.budget > 0 ? `<div class="category-progress"><div class="category-progress-bar ${colorClass}" style="width:${pct}%"></div></div>` : ''}
      <div class="category-card-budget-row">
        <span class="muted small">Monthly budget</span>
        <input type="number" class="category-budget-input" min="0" step="0.01" inputmode="decimal" placeholder="No budget" value="${cat.budget ? cat.budget : ''}">
      </div>
    `;
    li.querySelector('.category-budget-input').addEventListener('change', e => {
      const val = parseFloat(e.target.value);
      setCategoryBudget(cat.id, !val || val < 0 ? 0 : val);
      renderCategoriesView();
    });
    const addSpendBtn = li.querySelector('.add-category-spend-btn');
    if (addSpendBtn) addSpendBtn.addEventListener('click', () => openAddCategorySpendDialog(cat.id));
    makeCategoryNameEditable(li.querySelector('.category-name'), cat);
    const deleteCategoryBtn = li.querySelector('.delete-category-btn');
    if (deleteCategoryBtn) {
      deleteCategoryBtn.addEventListener('click', () => {
        openConfirm(
          'Delete category?',
          `Delete "${cat.name}"? This can't be undone.`,
          () => { deleteCategory(cat.id); renderAll(); },
        );
      });
    }
    categoryList.appendChild(li);
  }
}

// Tap-to-edit: clicking a category's name swaps it for a text input in
// place, saving on blur/Enter (Escape reverts) — replaces the old
// pencil-icon rename dialog with a direct, in-card edit.
function makeCategoryNameEditable(nameEl, cat) {
  const startEditing = () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'category-name-input';
    input.value = cat.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener('blur', () => {
      const newName = input.value.trim();
      if (newName && newName !== cat.name) renameCategory(cat.id, newName);
      renderCategoriesView();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); input.value = cat.name; input.blur(); }
    });
  };
  nameEl.addEventListener('click', startEditing);
  nameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditing(); }
  });
}

let pendingAddCategorySpendId = null;

function openAddCategorySpendDialog(categoryId) {
  const cat = findCategory(categoryId);
  if (!cat) return;
  pendingAddCategorySpendId = categoryId;
  addCategorySpendLabel.textContent = cat.name;
  addCategorySpendAmountInput.value = '';
  addCategorySpendDialog.showModal();
  addCategorySpendAmountInput.focus();
}

addCategorySpendCancelBtn.addEventListener('click', () => addCategorySpendDialog.close());

addCategorySpendConfirmBtn.addEventListener('click', () => {
  if (!pendingAddCategorySpendId || !homeMonthId) return;
  const amount = parseFloat(addCategorySpendAmountInput.value);
  if (!amount || amount <= 0) { addCategorySpendAmountInput.focus(); return; }
  const categoryId = pendingAddCategorySpendId;
  const monthId = homeMonthId;
  const cat = findCategory(categoryId);
  addCategorySpendDialog.close();
  confirmNonCurrentPeriod(monthId, 'Adding this spend.', () => {
    addSpend(monthId, categoryId, amount);
    playAddedSound();
    showToast(`${money(amount)} added to ${cat ? cat.name : 'category'}`);
    renderMoneyViews();
  });
});

function openAddCategoryDialog() {
  newCategoryNameInput.value = '';
  newCategoryBudgetInput.value = '';
  addCategoryDialog.showModal();
  newCategoryNameInput.focus();
}

addCategoryBtn.addEventListener('click', openAddCategoryDialog);

addCategoryCancelBtn.addEventListener('click', () => addCategoryDialog.close());

addCategoryConfirmBtn.addEventListener('click', () => {
  const cat = addCategory(newCategoryNameInput.value);
  if (!cat) { newCategoryNameInput.focus(); return; }
  const budget = parseFloat(newCategoryBudgetInput.value);
  if (budget > 0) setCategoryBudget(cat.id, budget);
  addCategoryDialog.close();
  renderAll();
});

// ── Report view ───────────────────────────────────────────────────────────────

let selectedMonthId = null;

function closeMonthDropdown() {
  monthDropdown.classList.add('hidden');
  monthTrigger.classList.remove('open');
}

function toggleMonthDropdown() {
  const isOpen = !monthDropdown.classList.contains('hidden');
  if (isOpen) closeMonthDropdown();
  else {
    monthDropdown.classList.remove('hidden');
    monthTrigger.classList.add('open');
  }
}

monthTrigger.addEventListener('click', toggleMonthDropdown);

function selectMonth(monthId) {
  selectedMonthId = monthId;
  closeMonthDropdown();
  renderReport();
}

function renderMonthSelect() {
  const sorted = [...data.months].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  if (!sorted.some(m => m.id === selectedMonthId)) {
    selectedMonthId = currentMonth()?.id ?? sorted[0]?.id ?? null;
  }

  monthDropdown.innerHTML = '';
  monthTriggerLabel.textContent = 'Select period';
  for (const m of sorted) {
    if (m.id === selectedMonthId) monthTriggerLabel.textContent = m.label;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item' + (m.id === selectedMonthId ? ' selected' : '');
    item.textContent = m.label;
    item.addEventListener('click', () => selectMonth(m.id));
    monthDropdown.appendChild(item);
  }
  // A visual nudge when viewing anything other than the current period.
  monthTrigger.classList.toggle('non-current', !!selectedMonthId && selectedMonthId !== data.currentMonthId);
}

let selectedCompareMonthId = null;

function closeCompareMonthDropdown() {
  compareMonthDropdown.classList.add('hidden');
  compareMonthTrigger.classList.remove('open');
}

function toggleCompareMonthDropdown() {
  const isOpen = !compareMonthDropdown.classList.contains('hidden');
  if (isOpen) closeCompareMonthDropdown();
  else {
    compareMonthDropdown.classList.remove('hidden');
    compareMonthTrigger.classList.add('open');
  }
}

compareMonthTrigger.addEventListener('click', toggleCompareMonthDropdown);

function selectCompareMonth(monthId) {
  selectedCompareMonthId = monthId;
  closeCompareMonthDropdown();
  renderReport();
}

const NO_COMPARE = '__none__';

// Defaults the comparison to whatever period immediately precedes the main
// one chronologically — same as the old automatic behaviour — but only
// when there's no valid explicit choice already (so switching the main
// period doesn't clobber a comparison the user picked on purpose, and an
// explicit "None" stays "None").
function defaultCompareMonthId(mainMonthId) {
  const idx = data.months.findIndex(m => m.id === mainMonthId);
  return idx > 0 ? data.months[idx - 1].id : NO_COMPARE;
}

function renderCompareMonthSelect() {
  const sorted = [...data.months].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const options = sorted.filter(m => m.id !== selectedMonthId);
  const isValid = selectedCompareMonthId === NO_COMPARE || options.some(m => m.id === selectedCompareMonthId);
  if (!isValid) {
    selectedCompareMonthId = defaultCompareMonthId(selectedMonthId);
  }

  compareMonthDropdown.innerHTML = '';

  const noneItem = document.createElement('button');
  noneItem.type = 'button';
  noneItem.className = 'dropdown-item' + (selectedCompareMonthId === NO_COMPARE ? ' selected' : '');
  noneItem.textContent = 'None';
  noneItem.addEventListener('click', () => selectCompareMonth(NO_COMPARE));
  compareMonthDropdown.appendChild(noneItem);

  for (const m of options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item' + (m.id === selectedCompareMonthId ? ' selected' : '');
    item.textContent = m.label;
    item.addEventListener('click', () => selectCompareMonth(m.id));
    compareMonthDropdown.appendChild(item);
  }

  const selectedM = options.find(m => m.id === selectedCompareMonthId);
  compareMonthTriggerLabel.textContent = selectedM ? selectedM.label : 'None';
}

// Colors a spend amount relative to its category's budget: green at or
// under budget, amber up to 10% over, red beyond that. No color (default
// text) when the category has no budget set — there's nothing to compare.
function budgetColorClass(amount, budget) {
  if (!budget || budget <= 0) return '';
  if (amount <= budget) return 'under-budget';
  if (amount <= budget * 1.1) return 'over-budget-mild';
  return 'over-budget';
}

function renderReport() {
  if (!data.months.length) {
    noPeriodsMsg.classList.remove('hidden');
    reportContent.classList.add('hidden');
    return;
  }
  noPeriodsMsg.classList.add('hidden');
  reportContent.classList.remove('hidden');

  renderMonthSelect();
  renderCompareMonthSelect();
  const month = data.months.find(m => m.id === selectedMonthId);
  const compareMonth = selectedCompareMonthId && selectedCompareMonthId !== NO_COMPARE
    ? data.months.find(m => m.id === selectedCompareMonthId)
    : null;

  const totals = categoryTotals(month);
  const compareTotals = compareMonth ? categoryTotals(compareMonth) : new Map();

  const ids = new Set([...totals.keys(), ...compareTotals.keys()]);
  const rows = [...ids]
    .map(id => ({
      id,
      name: findCategory(id)?.name || 'Unknown',
      amount: totals.get(id) || 0,
      compareAmount: compareTotals.get(id) || 0,
      budget: findCategory(id)?.budget || 0,
    }))
    .sort((a, b) => b.amount - a.amount || b.compareAmount - a.compareAmount);

  breakdownWrapper.classList.toggle('no-compare', !compareMonth);
  breakdownMainLabel.textContent = month.label;
  breakdownCompareLabel.textContent = compareMonth ? compareMonth.label : '';
  breakdownCompareLabel.classList.toggle('hidden', !compareMonth);
  breakdownTotalCompare.classList.toggle('hidden', !compareMonth);

  categoryBreakdown.innerHTML = '';
  if (!rows.length) {
    categoryBreakdown.innerHTML = '<li class="empty-msg">No spends recorded for this period.</li>';
    breakdownFooter.classList.add('hidden');
    return;
  }
  breakdownFooter.classList.remove('hidden');

  for (const r of rows) {
    const currentClass = budgetColorClass(r.amount, r.budget);

    const li = document.createElement('li');
    li.className = 'breakdown-item';
    li.innerHTML = `
      <span class="breakdown-cat-name">${escapeHtml(r.name)}</span>
      <span class="breakdown-cat-amount ${currentClass}">${money(r.amount)}</span>
      ${compareMonth ? `<span class="breakdown-cat-amount ${budgetColorClass(r.compareAmount, r.budget)}">${money(r.compareAmount)}</span>` : ''}
      <span class="breakdown-cat-budget">${r.budget > 0 ? money(r.budget) : '—'}</span>
    `;
    categoryBreakdown.appendChild(li);
  }

  breakdownTotalCurrent.textContent = money(rows.reduce((sum, r) => sum + r.amount, 0));
  breakdownTotalCompare.textContent = money(rows.reduce((sum, r) => sum + r.compareAmount, 0));
  breakdownTotalBudget.textContent = money(rows.reduce((sum, r) => sum + r.budget, 0));
}

// ── Periods view ──────────────────────────────────────────────────────────────

function renderAll() {
  renderMoneyViews();
}

function renderPeriodsView() {
  periodList.innerHTML = '';
  const sorted = [...data.months].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  if (!sorted.length) {
    periodList.innerHTML = '<li class="empty-msg">No periods yet.</li>';
    return;
  }
  for (const m of sorted) {
    const isCurrent = m.id === data.currentMonthId;
    const li = document.createElement('li');
    li.className = 'period-item';
    li.innerHTML = `
      <div class="period-info">
        <div class="period-name">${escapeHtml(m.label)}${isCurrent ? ' <span class="current-badge">Current</span>' : ''}</div>
        <div class="period-total">${money(monthTotal(m))} spent</div>
      </div>
      <div class="period-actions">
        ${!isCurrent ? `<button type="button" class="icon-btn-square make-current-btn" aria-label="Make current">${CHECK_ICON_SVG}</button>` : ''}
        <button type="button" class="icon-btn-square rename-period-btn" aria-label="Rename period">${PENCIL_ICON_SVG}</button>
        <button type="button" class="icon-btn-square danger delete-period-btn" aria-label="Delete period">${BIN_ICON_SVG}</button>
      </div>
    `;
    const makeCurrentBtn = li.querySelector('.make-current-btn');
    if (makeCurrentBtn) {
      makeCurrentBtn.addEventListener('click', () => {
        setCurrentMonth(m.id);
        renderAll();
      });
    }
    li.querySelector('.rename-period-btn').addEventListener('click', () => openRenamePeriodDialog(m.id));
    li.querySelector('.delete-period-btn').addEventListener('click', () => {
      const count = m.spends.length;
      openConfirm(
        'Delete period?',
        `Delete "${m.label}" and its ${count} spend${count === 1 ? '' : 's'}? This can't be undone.`,
        () => { deleteMonth(m.id); renderAll(); },
      );
    });
    periodList.appendChild(li);
  }
}

let pendingRenameMonthId = null;

function openRenamePeriodDialog(monthId) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return;
  pendingRenameMonthId = monthId;
  renameMonthInput.value = month.label;
  renameMonthDialog.showModal();
  renameMonthInput.focus();
}

renameMonthCancelBtn.addEventListener('click', () => renameMonthDialog.close());

renameMonthConfirmBtn.addEventListener('click', () => {
  if (!pendingRenameMonthId) return;
  renameMonth(pendingRenameMonthId, renameMonthInput.value);
  renameMonthDialog.close();
  renderAll();
});

function openAddPeriodDialog() {
  newPeriodNameInput.value = '';
  addPeriodDialog.showModal();
  newPeriodNameInput.focus();
}

addPeriodBtn.addEventListener('click', openAddPeriodDialog);

addPeriodCancelBtn.addEventListener('click', () => addPeriodDialog.close());

addPeriodConfirmBtn.addEventListener('click', () => {
  const period = addPeriod(newPeriodNameInput.value);
  if (!period) { newPeriodNameInput.focus(); return; }
  addPeriodDialog.close();
  renderAll();
});

// ── Sharing ───────────────────────────────────────────────────────────────────

shareBtn.addEventListener('click', () => {
  updateGroupUI();
  shareDialog.showModal();
});

closeShareBtn.addEventListener('click', () => shareDialog.close());

joinGroupBtn.addEventListener('click', () => {
  joinGroup(groupNameInput.value, groupPinInput.value);
});

inviteGroupBtn.addEventListener('click', () => {
  inviteToGroup();
});

leaveGroupBtn.addEventListener('click', () => {
  leaveGroup();
});

// ── Service worker / update banner ────────────────────────────────────────────

const updateBanner = document.getElementById('updateBanner');
const updateBannerText = document.getElementById('updateBannerText');
const reloadBtn = document.getElementById('reloadBtn');

let swRegistration = null;

// Not dismissible — reading the new version off the waiting sw.js (a plain
// no-store fetch of the file that's about to take over) so the banner can
// say *which* version is available, not just that one exists.
function showUpdateBanner() {
  updateBanner.classList.remove('hidden');
  fetch('sw.js', { cache: 'no-store' })
    .then(r => r.text())
    .then(text => {
      const match = text.match(/CACHE\s*=\s*'money-([^']+)'/);
      if (match) updateBannerText.textContent = `New version available (${match[1]})`;
    })
    .catch(() => {});
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    swRegistration = reg;
    if (reg.waiting) { showUpdateBanner(); return; }
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      const hadActive = !!reg.active;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && hadActive) showUpdateBanner();
      });
    });
  }).catch(() => {});

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && swRegistration) swRegistration.update();
  });

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

reloadBtn.addEventListener('click', () => {
  if (swRegistration && swRegistration.waiting) {
    swRegistration.waiting.postMessage('SKIP_WAITING');
  } else {
    window.location.reload();
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────

const toast = document.getElementById('toast');
let toastTimeout = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('version').textContent = APP_VERSION;
renderMoneyViews();
joinGroupFromUrl().then(joinedFromUrl => {
  if (!joinedFromUrl) initGroupFromStorage();
});
