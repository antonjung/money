const APP_VERSION = 'v1.0';

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'money-data';

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
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatMonthLabel(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
  const cat = { id: uid(), name };
  data.categories.push(cat);
  saveData();
  return cat;
}

// ── Spends ────────────────────────────────────────────────────────────────────

function addSpend(categoryId, amount, note) {
  currentMonth().spends.push({ id: uid(), categoryId, amount, note: note.trim(), at: new Date().toISOString() });
  saveData();
}

function deleteSpend(monthId, spendId) {
  const month = data.months.find(m => m.id === monthId);
  if (!month) return;
  month.spends = month.spends.filter(s => s.id !== spendId);
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

function startNewMonth() {
  currentMonth().endedAt = new Date().toISOString();
  data.months.push({ id: uid(), label: formatMonthLabel(new Date()), startedAt: new Date().toISOString(), endedAt: null, spends: [] });
  saveData();
}

// ── Formatting ────────────────────────────────────────────────────────────────

function money(n) {
  return '£' + n.toFixed(2);
}

// ── Elements ──────────────────────────────────────────────────────────────────

const tabs = document.querySelectorAll('.tab');
const spendView = document.getElementById('spendView');
const reportView = document.getElementById('reportView');

const currentMonthLabel = document.getElementById('currentMonthLabel');
const currentMonthTotal = document.getElementById('currentMonthTotal');
const spendForm = document.getElementById('spendForm');
const categorySelect = document.getElementById('categorySelect');
const newCategoryInput = document.getElementById('newCategoryInput');
const amountInput = document.getElementById('amountInput');
const noteInput = document.getElementById('noteInput');
const spendList = document.getElementById('spendList');

const monthSelect = document.getElementById('monthSelect');
const reportTotal = document.getElementById('reportTotal');
const categoryBreakdown = document.getElementById('categoryBreakdown');
const comparisonList = document.getElementById('comparisonList');

const menuBtn = document.getElementById('menuBtn');
const menuDialog = document.getElementById('menuDialog');
const menuCurrentLabel = document.getElementById('menuCurrentLabel');
const startMonthBtn = document.getElementById('startMonthBtn');
const categoryListMenu = document.getElementById('categoryListMenu');
const closeMenuBtn = document.getElementById('closeMenuBtn');

const confirmDialog = document.getElementById('confirmDialog');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmOkBtn = document.getElementById('confirmOkBtn');

// ── Tabs ──────────────────────────────────────────────────────────────────────

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    spendView.classList.toggle('hidden', view !== 'spend');
    reportView.classList.toggle('hidden', view !== 'report');
    if (view === 'report') renderReport();
  });
});

// ── Spend view ────────────────────────────────────────────────────────────────

function renderCategorySelect() {
  const prev = categorySelect.value;
  categorySelect.innerHTML = '';
  const sorted = [...data.categories].sort((a, b) => a.name.localeCompare(b.name));
  for (const cat of sorted) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    categorySelect.appendChild(opt);
  }
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Add new category…';
  categorySelect.appendChild(newOpt);

  if (sorted.some(c => c.id === prev)) {
    categorySelect.value = prev;
  } else if (!sorted.length) {
    categorySelect.value = '__new__';
  }
  toggleNewCategoryInput();
}

function toggleNewCategoryInput() {
  const isNew = categorySelect.value === '__new__';
  newCategoryInput.classList.toggle('hidden', !isNew);
  if (isNew) newCategoryInput.focus();
}

categorySelect.addEventListener('change', toggleNewCategoryInput);

function renderSpendView() {
  const month = currentMonth();
  currentMonthLabel.textContent = month.label;
  currentMonthTotal.textContent = money(monthTotal(month));

  spendList.innerHTML = '';
  if (!month.spends.length) {
    spendList.innerHTML = '<li class="empty-msg">No spends recorded yet this month.</li>';
    return;
  }
  const sorted = [...month.spends].sort((a, b) => new Date(b.at) - new Date(a.at));
  for (const s of sorted) {
    const cat = findCategory(s.categoryId);
    const li = document.createElement('li');
    li.className = 'spend-item';
    li.innerHTML = `
      <div class="spend-main">
        <div class="spend-category">${escapeHtml(cat ? cat.name : 'Unknown')}</div>
        ${s.note ? `<div class="spend-note">${escapeHtml(s.note)}</div>` : ''}
      </div>
      <div class="spend-amount">${money(s.amount)}</div>
      <button class="spend-delete" aria-label="Delete">✕</button>
    `;
    li.querySelector('.spend-delete').addEventListener('click', () => {
      deleteSpend(month.id, s.id);
      renderSpendView();
    });
    spendList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

spendForm.addEventListener('submit', e => {
  e.preventDefault();
  let categoryId = categorySelect.value;

  if (categoryId === '__new__') {
    const cat = addCategory(newCategoryInput.value);
    if (!cat) { newCategoryInput.focus(); return; }
    categoryId = cat.id;
  }

  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) { amountInput.focus(); return; }

  addSpend(categoryId, amount, noteInput.value);

  amountInput.value = '';
  noteInput.value = '';
  newCategoryInput.value = '';
  renderCategorySelect();
  categorySelect.value = categoryId;
  toggleNewCategoryInput();
  renderSpendView();
  amountInput.focus();
});

// ── Report view ───────────────────────────────────────────────────────────────

function renderMonthSelect() {
  const prev = monthSelect.value;
  monthSelect.innerHTML = '';
  const sorted = [...data.months].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  for (const m of sorted) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label + (m.endedAt ? '' : ' (current)');
    monthSelect.appendChild(opt);
  }
  monthSelect.value = sorted.some(m => m.id === prev) ? prev : currentMonth().id;
}

monthSelect.addEventListener('change', renderReport);

function renderReport() {
  renderMonthSelect();
  const monthId = monthSelect.value;
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
    categoryBreakdown.innerHTML = '<li class="empty-msg">No spends recorded for this month.</li>';
  } else {
    const max = Math.max(...rows.map(r => r.amount));
    for (const r of rows) {
      const pct = total ? Math.round((r.amount / total) * 100) : 0;
      const li = document.createElement('li');
      li.className = 'breakdown-item';
      li.innerHTML = `
        <div class="breakdown-row">
          <span class="breakdown-name">${escapeHtml(r.name)}</span>
          <span class="breakdown-amount">${money(r.amount)} · ${pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${max ? (r.amount / max) * 100 : 0}%"></div></div>
      `;
      categoryBreakdown.appendChild(li);
    }
  }

  comparisonList.innerHTML = '';
  if (!prevMonth) {
    comparisonList.innerHTML = '<li class="empty-msg">No previous month to compare.</li>';
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

// ── Menu / start new month ────────────────────────────────────────────────────

menuBtn.addEventListener('click', () => {
  menuCurrentLabel.textContent = currentMonth().label;
  categoryListMenu.innerHTML = '';
  const sorted = [...data.categories].sort((a, b) => a.name.localeCompare(b.name));
  if (!sorted.length) {
    categoryListMenu.innerHTML = '<li class="empty-msg">No categories yet.</li>';
  } else {
    for (const cat of sorted) {
      const li = document.createElement('li');
      li.textContent = cat.name;
      categoryListMenu.appendChild(li);
    }
  }
  menuDialog.showModal();
});

closeMenuBtn.addEventListener('click', () => menuDialog.close());

startMonthBtn.addEventListener('click', () => {
  confirmMessage.textContent = `This archives "${currentMonth().label}" and begins a new month. Past months stay available in Report.`;
  menuDialog.close();
  confirmDialog.showModal();
});

confirmCancelBtn.addEventListener('click', () => confirmDialog.close());

confirmOkBtn.addEventListener('click', () => {
  startNewMonth();
  confirmDialog.close();
  renderCategorySelect();
  renderSpendView();
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
renderSpendView();
