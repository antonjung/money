const APP_VERSION = 'v1.8';

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'money-data';
const GROUP_STORAGE_KEY = 'money-group';

function loadData() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
  if (!data || !Array.isArray(data.months) || !data.months.length) {
    data = {
      categories: [],
      months: [{ id: uid(), label: formatMonthLabel(new Date()), startedAt: new Date().toISOString(), endedAt: null, spends: [] }],
    };
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

function formatMonthLabel(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayISODate() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const data = loadData();

function currentMonth() {
  return data.months[data.months.length - 1];
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

// ── Spends ────────────────────────────────────────────────────────────────────

function addSpend(categoryId, amount) {
  currentMonth().spends.push({ id: uid(), categoryId, amount, note: '', at: todayISODate() });
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

function startNewMonth(label) {
  currentMonth().endedAt = new Date().toISOString();
  label = (label || '').trim();
  data.months.push({ id: uid(), label: label || formatMonthLabel(new Date()), startedAt: new Date().toISOString(), endedAt: null, spends: [] });
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
  if (!data.months.length) {
    data.months.push({ id: uid(), label: formatMonthLabel(new Date()), startedAt: new Date().toISOString(), endedAt: null, spends: [] });
  } else {
    data.months[data.months.length - 1].endedAt = null; // whatever's now last is the current month
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
  return JSON.stringify({ categories: data.categories, months: data.months });
}

function setGroupStatus(text, cls) {
  const el = document.getElementById('groupStatus');
  el.textContent = text;
  el.className = 'group-status' + (cls ? ' ' + cls : '');
}

function updateGroupUI() {
  const joinForm = document.getElementById('groupJoinForm');
  const leaveBtn = document.getElementById('leaveGroupBtn');
  if (activeGroup) {
    joinForm.classList.add('hidden');
    leaveBtn.classList.remove('hidden');
    setGroupStatus(`Shared as "${activeGroup.name}"`, 'active');
  } else {
    joinForm.classList.remove('hidden');
    leaveBtn.classList.add('hidden');
    setGroupStatus('Not shared — data stays on this device.');
  }
}

async function pushGroupData() {
  if (!activeGroup) return;
  const sig = dataSignature();
  const payload = { v: 1, categories: data.categories, months: data.months };
  const enc = await encryptForGroup(payload, activeGroup.key);
  lastGroupSignature = sig;
  await activeGroup.ref.set({ ciphertext: enc.ciphertext, iv: enc.iv, v: 1, updatedAt: Date.now() });
}

function maybeSyncToGroup() {
  if (!activeGroup || applyingRemote) return;
  pushGroupData().catch(() => setGroupStatus('Sync failed — will retry on next change.', 'error'));
}

function applyIncomingGroupDoc(decoded) {
  const sig = JSON.stringify({ categories: decoded.categories, months: decoded.months });
  if (sig === lastGroupSignature) return; // our own write echoing back
  lastGroupSignature = sig;
  applyingRemote = true;
  data.categories = decoded.categories || [];
  data.months = decoded.months && decoded.months.length ? decoded.months : data.months;
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
  if (!name || !pin) { setGroupStatus('Enter a group name and PIN.', 'error'); return; }
  if (!firebaseConfigured()) { setGroupStatus('Sharing is not configured for this app.', 'error'); return; }

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
        return;
      }
      // Reconnecting to a group already joined on this device (e.g. on page load)
      // shouldn't re-prompt — the local data *is* that group's data already.
      const hasLocalContent = data.categories.length || data.months.some(m => m.spends.length);
      if (!silent && hasLocalContent && !confirm(`Joining "${name}" replaces this device's data with the group's shared data. Continue?`)) {
        setGroupStatus('Not shared — data stays on this device.');
        return;
      }
      data.categories = decoded.categories || [];
      data.months = decoded.months && decoded.months.length ? decoded.months : data.months;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      lastGroupSignature = dataSignature();
    }

    activeGroup = { name, pin, id, key, ref, unsubscribe: null };
    localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify({ name, pin }));

    if (!snap.exists) await pushGroupData();

    startGroupListener();
    updateGroupUI();
    renderAll();
  } catch (err) {
    setGroupStatus('Could not connect — check your connection and try again.', 'error');
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

// ── Elements ──────────────────────────────────────────────────────────────────

const BIN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

const tabs = document.querySelectorAll('.nav-tab');
const spendView = document.getElementById('spendView');
const historyView = document.getElementById('historyView');
const reportView = document.getElementById('reportView');
const categoriesView = document.getElementById('categoriesView');

const currentMonthLabel = document.getElementById('currentMonthLabel');
const currentMonthTotal = document.getElementById('currentMonthTotal');
const noCategoriesMsg = document.getElementById('noCategoriesMsg');
const emptyAddCategoryBtn = document.getElementById('emptyAddCategoryBtn');
const spendForm = document.getElementById('spendForm');
const categoryTrigger = document.getElementById('categoryTrigger');
const categoryTriggerLabel = document.getElementById('categoryTriggerLabel');
const categoryDropdown = document.getElementById('categoryDropdown');
const amountInput = document.getElementById('amountInput');

const historyMonthLabel = document.getElementById('historyMonthLabel');
const historyMonthTotal = document.getElementById('historyMonthTotal');
const spendList = document.getElementById('spendList');

const monthTrigger = document.getElementById('monthTrigger');
const monthTriggerLabel = document.getElementById('monthTriggerLabel');
const monthDropdown = document.getElementById('monthDropdown');
const renameMonthBtn = document.getElementById('renameMonthBtn');
const deleteMonthBtn = document.getElementById('deleteMonthBtn');
const reportTotal = document.getElementById('reportTotal');
const categoryBreakdown = document.getElementById('categoryBreakdown');
const comparisonList = document.getElementById('comparisonList');

const categoryList = document.getElementById('categoryList');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const addCategoryDialog = document.getElementById('addCategoryDialog');
const newCategoryNameInput = document.getElementById('newCategoryNameInput');
const newCategoryBudgetInput = document.getElementById('newCategoryBudgetInput');
const addCategoryCancelBtn = document.getElementById('addCategoryCancelBtn');
const addCategoryConfirmBtn = document.getElementById('addCategoryConfirmBtn');

const shareBtn = document.getElementById('shareBtn');
const shareDialog = document.getElementById('shareDialog');
const closeShareBtn = document.getElementById('closeShareBtn');
const groupNameInput = document.getElementById('groupNameInput');
const groupPinInput = document.getElementById('groupPinInput');
const joinGroupBtn = document.getElementById('joinGroupBtn');
const leaveGroupBtn = document.getElementById('leaveGroupBtn');

const startMonthBtn = document.getElementById('startMonthBtn');
const startMonthDialog = document.getElementById('startMonthDialog');
const startMonthMessage = document.getElementById('startMonthMessage');
const newMonthNameInput = document.getElementById('newMonthNameInput');
const startMonthCancelBtn = document.getElementById('startMonthCancelBtn');
const startMonthConfirmBtn = document.getElementById('startMonthConfirmBtn');

const renameMonthDialog = document.getElementById('renameMonthDialog');
const renameMonthInput = document.getElementById('renameMonthInput');
const renameMonthCancelBtn = document.getElementById('renameMonthCancelBtn');
const renameMonthConfirmBtn = document.getElementById('renameMonthConfirmBtn');

const confirmDialog = document.getElementById('confirmDialog');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmOkBtn = document.getElementById('confirmOkBtn');

let pendingConfirmAction = null;

function openConfirm(title, message, action) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  pendingConfirmAction = action;
  confirmDialog.showModal();
}

confirmCancelBtn.addEventListener('click', () => {
  pendingConfirmAction = null;
  confirmDialog.close();
});

confirmOkBtn.addEventListener('click', () => {
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  confirmDialog.close();
  if (action) action();
});

// ── Tabs ──────────────────────────────────────────────────────────────────────

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    spendView.classList.toggle('hidden', view !== 'spend');
    historyView.classList.toggle('hidden', view !== 'history');
    reportView.classList.toggle('hidden', view !== 'report');
    categoriesView.classList.toggle('hidden', view !== 'categories');
    if (view === 'history') renderHistoryView();
    if (view === 'report') renderReport();
    if (view === 'categories') renderCategoriesView();
  });
});

// ── Spend view ────────────────────────────────────────────────────────────────

let selectedCategoryId = null;

function closeCategoryDropdown() {
  categoryDropdown.classList.add('hidden');
  categoryTrigger.classList.remove('open');
}

function toggleCategoryDropdown() {
  const isOpen = !categoryDropdown.classList.contains('hidden');
  if (isOpen) closeCategoryDropdown();
  else {
    categoryDropdown.classList.remove('hidden');
    categoryTrigger.classList.add('open');
  }
}

categoryTrigger.addEventListener('click', toggleCategoryDropdown);

function selectCategory(catId) {
  selectedCategoryId = catId;
  closeCategoryDropdown();
  renderCategorySelect();
}

function renderCategorySelect() {
  const sorted = [...data.categories].sort((a, b) => a.name.localeCompare(b.name));
  if (!sorted.some(c => c.id === selectedCategoryId)) {
    selectedCategoryId = sorted.length ? sorted[0].id : null;
  }
  categoryTriggerLabel.textContent = selectedCategoryId ? findCategory(selectedCategoryId).name : 'Select category';

  categoryDropdown.innerHTML = '';
  for (const cat of sorted) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item' + (cat.id === selectedCategoryId ? ' selected' : '');
    item.textContent = cat.name;
    item.addEventListener('click', () => selectCategory(cat.id));
    categoryDropdown.appendChild(item);
  }

  const hasCategories = sorted.length > 0;
  noCategoriesMsg.classList.toggle('hidden', hasCategories);
  spendForm.classList.toggle('hidden', !hasCategories);
}

function renderCurrentMonthBanner() {
  const month = currentMonth();
  currentMonthLabel.textContent = month.label;
  currentMonthTotal.textContent = money(monthTotal(month));
}

function renderHistoryView() {
  const month = currentMonth();
  historyMonthLabel.textContent = month.label;
  historyMonthTotal.textContent = money(monthTotal(month));

  spendList.innerHTML = '';
  if (!month.spends.length) {
    spendList.innerHTML = '<li class="empty-msg">No spends recorded yet this period.</li>';
    return;
  }
  const sorted = [...month.spends].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
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
      <button class="spend-delete" aria-label="Delete">${BIN_ICON_SVG}</button>
    `;
    li.querySelector('.spend-date-input').addEventListener('change', e => {
      updateSpendDate(month.id, s.id, e.target.value || todayISODate());
      renderHistoryView();
    });
    li.querySelector('.spend-delete').addEventListener('click', () => {
      openConfirm(
        'Delete spend?',
        `Delete this ${money(s.amount)} spend${cat ? ' in ' + cat.name : ''}? This can't be undone.`,
        () => { deleteSpend(month.id, s.id); renderAll(); },
      );
    });
    spendList.appendChild(li);
  }
}

function renderMoneyViews() {
  renderCurrentMonthBanner();
  renderHistoryView();
  if (!reportView.classList.contains('hidden')) renderReport();
  if (!categoriesView.classList.contains('hidden')) renderCategoriesView();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

spendForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!selectedCategoryId) return;

  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) { amountInput.focus(); return; }

  addSpend(selectedCategoryId, amount);

  amountInput.value = '';
  amountInput.blur();
  renderMoneyViews();
});

// ── Categories view ───────────────────────────────────────────────────────────

function renderCategoriesView() {
  categoryList.innerHTML = '';
  const sorted = [...data.categories].sort((a, b) => a.name.localeCompare(b.name));
  if (!sorted.length) {
    categoryList.innerHTML = '<li class="empty-msg">No categories yet.</li>';
    return;
  }
  for (const cat of sorted) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="category-name">${escapeHtml(cat.name)}</span>
      <input type="number" class="category-budget-input" min="0" step="0.01" inputmode="decimal" placeholder="No budget" value="${cat.budget ? cat.budget : ''}">
    `;
    li.querySelector('.category-budget-input').addEventListener('change', e => {
      const val = parseFloat(e.target.value);
      setCategoryBudget(cat.id, !val || val < 0 ? 0 : val);
    });
    categoryList.appendChild(li);
  }
}

function openAddCategoryDialog() {
  newCategoryNameInput.value = '';
  newCategoryBudgetInput.value = '';
  addCategoryDialog.showModal();
  newCategoryNameInput.focus();
}

addCategoryBtn.addEventListener('click', openAddCategoryDialog);
emptyAddCategoryBtn.addEventListener('click', openAddCategoryDialog);

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
  if (!sorted.some(m => m.id === selectedMonthId)) selectedMonthId = currentMonth().id;

  monthDropdown.innerHTML = '';
  for (const m of sorted) {
    const label = m.label + (m.endedAt ? '' : ' (current)');
    if (m.id === selectedMonthId) monthTriggerLabel.textContent = label;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item' + (m.id === selectedMonthId ? ' selected' : '');
    item.textContent = label;
    item.addEventListener('click', () => selectMonth(m.id));
    monthDropdown.appendChild(item);
  }
}

function renderReport() {
  renderMonthSelect();
  const monthId = selectedMonthId;
  const idx = data.months.findIndex(m => m.id === monthId);
  const month = data.months[idx];
  const prevMonth = idx > 0 ? data.months[idx - 1] : null;

  const total = monthTotal(month);
  reportTotal.textContent = money(total);

  const totals = categoryTotals(month);
  const rows = [...totals.entries()]
    .map(([id, amount]) => ({ id, name: findCategory(id)?.name || 'Unknown', amount }))
    .sort((a, b) => b.amount - a.amount);

  categoryBreakdown.innerHTML = '';
  if (!rows.length) {
    categoryBreakdown.innerHTML = '<li class="empty-msg">No spends recorded for this period.</li>';
  } else {
    const max = Math.max(...rows.map(r => r.amount));
    for (const r of rows) {
      const pct = total ? Math.round((r.amount / total) * 100) : 0;
      const budget = findCategory(r.id)?.budget || 0;
      const overBudget = budget > 0 && r.amount > budget;

      let barHtml, budgetHtml = '';
      if (budget > 0) {
        const remaining = budget - r.amount;
        budgetHtml = `<div class="breakdown-budget ${overBudget ? 'over-budget' : 'under-budget'}">${overBudget ? `Over by ${money(-remaining)}` : `${money(remaining)} left`} of ${money(budget)} budget</div>`;

        // Bar always fills 100%: under budget it's spend (blue) + headroom (green);
        // over budget it's budget (blue) + the overspend (red) — so the blue portion
        // always represents "budget" and shrinks as a share once you go over it.
        const bluePct = overBudget ? (budget / r.amount) * 100 : (r.amount / budget) * 100;
        const secondClass = overBudget ? 'red' : 'green';
        barHtml = `<div class="bar-segment blue" style="width:${bluePct}%"></div><div class="bar-segment ${secondClass}" style="width:${100 - bluePct}%"></div>`;
      } else {
        barHtml = `<div class="bar-segment neutral" style="width:${max ? (r.amount / max) * 100 : 0}%"></div>`;
      }

      const li = document.createElement('li');
      li.className = 'breakdown-item';
      li.innerHTML = `
        <div class="breakdown-row">
          <span class="breakdown-name">${escapeHtml(r.name)}</span>
          <span class="breakdown-amount">${money(r.amount)} · ${pct}%</span>
        </div>
        <div class="bar-track">${barHtml}</div>
        ${budgetHtml}
      `;
      categoryBreakdown.appendChild(li);
    }
  }

  comparisonList.innerHTML = '';
  if (!prevMonth) {
    comparisonList.innerHTML = '<li class="empty-msg">No previous period to compare.</li>';
    return;
  }
  const prevTotals = categoryTotals(prevMonth);
  const ids = new Set([...totals.keys(), ...prevTotals.keys()]);
  const compareRows = [...ids]
    .map(id => ({
      id,
      name: findCategory(id)?.name || 'Unknown',
      cur: totals.get(id) || 0,
      prev: prevTotals.get(id) || 0,
    }))
    .sort((a, b) => b.cur - a.cur);

  for (const r of compareRows) {
    const delta = r.cur - r.prev;
    const deltaClass = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-flat';
    const sign = delta > 0 ? '+' : '';
    const li = document.createElement('li');
    li.className = 'comparison-item';
    li.innerHTML = `
      <div>
        <div class="comparison-name">${escapeHtml(r.name)}</div>
        <div class="comparison-prev">${money(r.prev)} → ${money(r.cur)}</div>
      </div>
      <div class="comparison-delta ${deltaClass}">${sign}${money(Math.abs(delta))}</div>
    `;
    comparisonList.appendChild(li);
  }
}

// ── Start / rename / delete period ────────────────────────────────────────────

function renderAll() {
  renderCategorySelect();
  renderMoneyViews();
}

startMonthBtn.addEventListener('click', () => {
  startMonthMessage.textContent = `This archives "${currentMonth().label}" and begins a new period. Past periods stay available in Summary.`;
  newMonthNameInput.value = formatMonthLabel(new Date());
  startMonthDialog.showModal();
});

startMonthCancelBtn.addEventListener('click', () => startMonthDialog.close());

startMonthConfirmBtn.addEventListener('click', () => {
  startNewMonth(newMonthNameInput.value);
  startMonthDialog.close();
  renderAll();
});

renameMonthBtn.addEventListener('click', () => {
  const month = data.months.find(m => m.id === selectedMonthId);
  if (!month) return;
  renameMonthInput.value = month.label;
  renameMonthDialog.showModal();
  renameMonthInput.focus();
});

renameMonthCancelBtn.addEventListener('click', () => renameMonthDialog.close());

renameMonthConfirmBtn.addEventListener('click', () => {
  const month = data.months.find(m => m.id === selectedMonthId);
  if (!month) return;
  renameMonth(month.id, renameMonthInput.value);
  renameMonthDialog.close();
  renderAll();
});

deleteMonthBtn.addEventListener('click', () => {
  const month = data.months.find(m => m.id === selectedMonthId);
  if (!month) return;
  const count = month.spends.length;
  openConfirm(
    'Delete period?',
    `Delete "${month.label}" and its ${count} spend${count === 1 ? '' : 's'}? This can't be undone.`,
    () => { deleteMonth(month.id); renderAll(); },
  );
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

leaveGroupBtn.addEventListener('click', () => {
  leaveGroup();
});

// ── Service worker / update banner ────────────────────────────────────────────

const updateBanner = document.getElementById('updateBanner');
const reloadBtn = document.getElementById('reloadBtn');
const dismissUpdateBtn = document.getElementById('dismissUpdateBtn');

let swRegistration = null;

function showUpdateBanner() {
  updateBanner.classList.remove('hidden');
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

dismissUpdateBtn.addEventListener('click', () => updateBanner.classList.add('hidden'));

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('version').textContent = APP_VERSION;
renderCategorySelect();
renderMoneyViews();
initGroupFromStorage();
