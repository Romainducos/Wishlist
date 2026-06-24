// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://rlifarrxzugydbfzmhyz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_azmlH82WQ5dKOZ0gmEv7YA_P3m8l3MZ';
// ─────────────────────────────────────────────────────────────

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const LS_PREFIX = 'wishlist_v5_';

let currentUser  = null;
let searchQuery  = '';
let readOnlyMode = false;
let activeTab    = 'perso'; // 'perso' | 'cadeaux'

// ── State factories ───────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2, 10); }

function defaultRow() {
  return {
    id: genId(), name: '', price: '', qty: 1, url: '',
    checked: false, priority: false, note: '',
    category: '', targetDate: ''
  };
}

function defaultList(name = 'Ma wishlist') {
  return {
    id: genId(), name,
    alreadySaved: '', monthlySavings: '',
    collapsed: false,
    rows: [defaultRow(), defaultRow()]
  };
}

function defaultState() {
  return {
    perso:   { lists: [defaultList('Ma wishlist')] },
    cadeaux: { lists: [defaultList('Liste de cadeaux')] }
  };
}

let state = defaultState();

// Helper: listes de l'onglet actif
function activeLists() { return state[activeTab].lists; }

function getList(listId)        { return activeLists().find(l => l.id === listId); }
function getRow(listId, rowId)  { return getList(listId)?.rows.find(r => r.id === rowId); }

function migrateTabData(tabData) {
  if (!tabData || !tabData.lists) return { lists: [defaultList()] };
  return {
    lists: tabData.lists.map(l => ({
      collapsed: false,
      ...l,
      rows: (l.rows || []).map(r => ({
        category: '', targetDate: '',
        id: r.id || genId(), checked: false, priority: false, note: '', url: '',
        ...r
      }))
    }))
  };
}

function migrate(raw) {
  if (!raw) return defaultState();

  // Format V2 : { perso: {...}, cadeaux: {...} }
  if (raw.perso) {
    return {
      perso:   migrateTabData(raw.perso),
      cadeaux: raw.cadeaux
        ? migrateTabData(raw.cadeaux)
        : { lists: [defaultList('Liste de cadeaux')] }
    };
  }

  // Format V1 : { lists: [...] }
  if (raw.lists) {
    return {
      perso:   migrateTabData(raw),
      cadeaux: { lists: [defaultList('Liste de cadeaux')] }
    };
  }

  // Format très ancien : { rows: [...] }
  if (raw.rows) {
    const list = {
      id: genId(), name: 'Ma wishlist',
      alreadySaved: raw.alreadySaved || '', monthlySavings: raw.monthlySavings || '',
      collapsed: false,
      rows: (raw.rows || []).map(r => ({
        id: genId(), checked: false, priority: false, note: '', url: '',
        category: '', targetDate: '',
        name: r.name || '', price: r.price || '', qty: r.qty || 1, ...r
      }))
    };
    if (!list.rows.length) list.rows.push(defaultRow());
    return {
      perso:   { lists: [list] },
      cadeaux: { lists: [defaultList('Liste de cadeaux')] }
    };
  }

  return defaultState();
}

// ── Tabs ──────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  const titles = { perso: 'Perso', cadeaux: 'Cadeaux' };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[tab] || tab;
  renderAllLists();
}

// ── Auth ──────────────────────────────────────────────────────

async function initAuth() {
  const shareId = new URLSearchParams(window.location.search).get('share');
  if (shareId) { await loadSharedList(shareId); return; }

  initConnectionStatus();
  const { data: { session } } = await db.auth.getSession();
  if (session) await onLogin(session.user);
  else showAuthScreen();

  db.auth.onAuthStateChange(async (_event, session) => {
    if (session) await onLogin(session.user);
    else { currentUser = null; state = defaultState(); showAuthScreen(); }
  });
}

function initConnectionStatus() {
  const update = () => {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.textContent = navigator.onLine ? '● En ligne' : '● Hors ligne';
    el.className = 'conn-status' + (navigator.onLine ? ' online' : ' offline');
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

async function onLogin(user) {
  currentUser = user;
  document.getElementById('user-email').textContent = user.email;
  loadFromLocalStorage();
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display        = 'flex';
  renderAllLists();
  await loadFromSupabase();
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display        = 'none';
}

let authMode = 'login';

function switchAuthTab(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === mode));
  document.getElementById('auth-submit').textContent =
    mode === 'login' ? 'Se connecter' : "S'inscrire";
  setAuthMsg('', false);
}

async function submitAuth() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const btn      = document.getElementById('auth-submit');
  if (!email || !password) { setAuthMsg('Email et mot de passe requis.'); return; }
  btn.disabled = true; btn.textContent = '…'; setAuthMsg('', false);
  try {
    const fn = authMode === 'login'
      ? db.auth.signInWithPassword({ email, password })
      : db.auth.signUp({ email, password });
    const result = await fn;
    if (result.error) setAuthMsg(result.error.message);
    else if (authMode === 'signup' && !result.data.session)
      setAuthMsg('Vérifie ton email pour confirmer ton compte.', true);
  } catch { setAuthMsg('Erreur inattendue, réessaie.'); }
  finally {
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Se connecter' : "S'inscrire";
  }
}

function setAuthMsg(text, isSuccess = false) {
  const el = document.getElementById('auth-msg');
  el.textContent = text;
  el.className = 'auth-msg' + (isSuccess ? ' success' : '');
}

async function logout() { await db.auth.signOut(); }

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('auth-screen').style.display !== 'none')
    submitAuth();
});

// ── Storage ───────────────────────────────────────────────────

function lsKey() { return LS_PREFIX + (currentUser?.id || ''); }

function loadFromLocalStorage() {
  try { const raw = localStorage.getItem(lsKey()); if (raw) state = migrate(JSON.parse(raw)); } catch(e) {}
}

function saveToLocalStorage() {
  try { localStorage.setItem(lsKey(), JSON.stringify(state)); } catch(e) {}
}

async function loadFromSupabase() {
  if (!currentUser) return;
  try {
    const { data } = await db.from('wishlists').select('data')
      .eq('user_id', currentUser.id).maybeSingle();
    if (data?.data) {
      state = migrate(data.data);
      saveToLocalStorage();
      renderAllLists();
    }
  } catch(e) { console.error('Load error:', e); }
}

let saveTimer;
function save() {
  if (readOnlyMode) return;
  saveToLocalStorage();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!currentUser) return;
    try {
      await db.from('wishlists').upsert({
        user_id: currentUser.id, data: state, updated_at: new Date().toISOString()
      });
      const el = document.getElementById('save-indicator');
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 1500);
    } catch(e) { console.error('Save error:', e); }
  }, 700);
}

// ── Share ─────────────────────────────────────────────────────

async function shareList(listId) {
  if (!currentUser) return;
  const list = getList(listId);
  if (!list) return;
  try {
    const shareId = genId() + genId();
    await db.from('list_shares').upsert({
      id: shareId, user_id: currentUser.id,
      list_id: listId, list_data: list,
      updated_at: new Date().toISOString()
    });
    const url = `${location.origin}${location.pathname}?share=${shareId}`;
    await navigator.clipboard.writeText(url);
    showToast('Lien copié dans le presse-papier !');
  } catch(e) {
    showToast('Erreur — vérifie la table list_shares dans Supabase', true);
  }
}

async function loadSharedList(shareId) {
  readOnlyMode = true;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display         = 'flex';
  document.getElementById('user-email').textContent    = 'Vue partagée';
  document.querySelector('.logout-btn').style.display  = 'none';
  document.getElementById('add-list-btn').style.display = 'none';

  try {
    const { data } = await db.from('list_shares')
      .select('list_data').eq('id', shareId).maybeSingle();
    if (data?.list_data) {
      state.perso = { lists: [data.list_data] };
    }
  } catch(e) {}
  renderAllLists();
}

// ── Toast ─────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── Search ────────────────────────────────────────────────────

function onSearch(value) {
  searchQuery = value.toLowerCase().trim();
  renderAllLists();
}

// ── Render ────────────────────────────────────────────────────

function renderAllLists() {
  const container = document.getElementById('lists-container');
  container.innerHTML = '';
  activeLists().forEach(list => {
    const section = buildListSection(list);
    container.appendChild(section);
    renderRowsForList(list.id);
    renderArchiveSection(list.id);
    recalcList(list.id);
  });
}

function buildListSection(list) {
  const isGift = activeTab === 'cadeaux';
  const section = document.createElement('div');
  section.className = 'list-section' + (list.collapsed ? ' is-collapsed' : '');
  section.dataset.listId = list.id;

  section.innerHTML = `
    <div class="list-section-header" onclick="handleHeaderClick(event,'${list.id}')">
      <div class="list-header-left">
        <span class="collapse-icon">${list.collapsed ? '▶' : '▼'}</span>
        <h2 class="list-section-title">${esc(list.name)}</h2>
      </div>
      <div class="list-section-actions" onclick="event.stopPropagation()">${buildListActions(list.id)}</div>
    </div>

    ${isGift ? `
    <div class="gift-share-bar">
      <span class="gift-share-label">Partager cette liste avec tes amis</span>
      <button class="gift-share-btn" onclick="shareList('${list.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Copier le lien
      </button>
    </div>` : ''}

    <div class="list-body">
      <div class="list-config">
        <div class="config-grid">
          <div class="field">
            <label>Déjà économisé</label>
            <div class="input-wrap">
              <input type="number" value="${esc(list.alreadySaved||'')}" placeholder="0" min="0" step="50"
                oninput="onConfigInput('${list.id}','alreadySaved',this.value)" ${readOnlyMode ? 'disabled' : ''} />
              <span class="unit">€</span>
            </div>
          </div>
          <div class="field">
            <label>Épargne mensuelle</label>
            <div class="input-wrap">
              <input type="number" value="${esc(list.monthlySavings||'')}" placeholder="500" min="0" step="50"
                oninput="onConfigInput('${list.id}','monthlySavings',this.value)" ${readOnlyMode ? 'disabled' : ''} />
              <span class="unit">€/mois</span>
            </div>
          </div>
        </div>
      </div>

      <div id="category-filter-${list.id}" class="category-filter"></div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-drag"></th>
              <th class="col-name">Article</th>
              <th class="col-price">Prix (€)</th>
              <th class="col-qty">Qté</th>
              <th class="col-sub">Sous-total</th>
              <th class="col-prio"></th>
              <th class="col-check"></th>
            </tr>
          </thead>
          <tbody id="tbody-${list.id}"></tbody>
        </table>
      </div>

      ${readOnlyMode ? '' : `
      <button class="add-btn" onclick="addRow('${list.id}')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/>
        </svg>
        Ajouter un article
      </button>`}

      <div id="archive-${list.id}" class="archive-section"></div>

      <div class="list-summary">
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">Total restant</div>
            <div class="metric-value" id="s-total-${list.id}">0 €</div>
          </div>
          <div class="metric">
            <div class="metric-label">Reste à économiser</div>
            <div class="metric-value" id="s-reste-${list.id}">0 €</div>
          </div>
          <div class="metric">
            <div class="metric-label">Temps estimé</div>
            <div class="metric-value" id="s-time-${list.id}">—</div>
            <div class="metric-sub" id="s-time-sub-${list.id}"></div>
          </div>
        </div>
        <div class="progress-section">
          <div class="progress-header">
            <span>Progression</span>
            <span id="pct-label-${list.id}">0%</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" id="bar-fill-${list.id}" style="width:0%"></div>
          </div>
        </div>
        <div id="graph-${list.id}" class="graph-section"></div>
      </div>
    </div>
  `;

  return section;
}

// ── Collapse ──────────────────────────────────────────────────

function handleHeaderClick(e, listId) {
  if (e.target.closest('.list-section-actions') || e.target.closest('.list-title-input')) return;
  toggleCollapse(listId);
}

function toggleCollapse(listId) {
  const list = getList(listId);
  if (!list) return;
  list.collapsed = !list.collapsed;
  save();
  const section = document.querySelector(`[data-list-id="${listId}"]`);
  if (section) {
    section.classList.toggle('is-collapsed', list.collapsed);
    section.querySelector('.collapse-icon').textContent = list.collapsed ? '▶' : '▼';
  }
}

// ── Lists CRUD ────────────────────────────────────────────────

function addList() {
  const name = activeTab === 'cadeaux' ? 'Nouvelle liste' : 'Nouvelle liste';
  const newList = defaultList(name);
  activeLists().push(newList);
  save();
  renderAllLists();
  setTimeout(() => renameList(newList.id), 30);
}

function renameList(listId) {
  const section = document.querySelector(`[data-list-id="${listId}"]`);
  const titleEl = section?.querySelector('.list-section-title');
  if (!titleEl || titleEl.querySelector('input')) return;

  const list = getList(listId);
  if (!list) return;

  const input = document.createElement('input');
  input.className = 'list-title-input';
  input.value = list.name;

  const commit = () => {
    const val = input.value.trim() || list.name;
    list.name = val;
    save();
    titleEl.textContent = val;
  };

  input.onblur = commit;
  input.onkeydown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = list.name; input.blur(); }
  };

  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
}

function deleteList(listId) {
  if (activeLists().length === 1) return;
  const section = document.querySelector(`[data-list-id="${listId}"]`);
  const actions = section?.querySelector('.list-section-actions');
  if (!actions) return;
  actions.innerHTML = `
    <span class="delete-confirm-label">Supprimer ?</span>
    <button class="list-action-btn danger" onclick="confirmDeleteList('${listId}')">Oui</button>
    <button class="list-action-btn" onclick="cancelDelete('${listId}')">Non</button>
  `;
}

function confirmDeleteList(listId) {
  state[activeTab].lists = activeLists().filter(l => l.id !== listId);
  save();
  renderAllLists();
}

function cancelDelete(listId) {
  const section = document.querySelector(`[data-list-id="${listId}"]`);
  const actions = section?.querySelector('.list-section-actions');
  if (actions) actions.innerHTML = buildListActions(listId);
}

function buildListActions(listId) {
  if (readOnlyMode) return '';
  const showShare = activeTab !== 'cadeaux'; // cadeaux a sa propre barre de partage
  return `
    ${showShare ? `
    <button class="list-action-btn" onclick="shareList('${listId}')" title="Partager">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    </button>` : ''}
    <button class="list-action-btn" onclick="renameList('${listId}')" title="Renommer">✎</button>
    ${activeLists().length > 1
      ? `<button class="list-action-btn danger" onclick="deleteList('${listId}')" title="Supprimer">🗑</button>`
      : ''}
  `;
}

function onConfigInput(listId, field, value) {
  const list = getList(listId);
  if (list) { list[field] = value; save(); recalcList(listId); }
}

// ── Row expand ────────────────────────────────────────────────

const expandedRows = new Set();

function toggleRowExpand(listId, rowId) {
  if (expandedRows.has(rowId)) expandedRows.delete(rowId);
  else expandedRows.add(rowId);
  renderRowsForList(listId);
}

function isRowExpanded(row) {
  return expandedRows.has(row.id) || !!(row.note || row.category || row.targetDate);
}

// ── Rows CRUD ─────────────────────────────────────────────────

function addRow(listId) {
  const list = getList(listId);
  if (!list) return;
  const row = defaultRow();
  list.rows.push(row);
  save();
  renderRowsForList(listId);
  recalcList(listId);
  document.getElementById(`tbody-${listId}`)
    ?.querySelector('tr:last-child')?.querySelector('input')?.focus();
}

function delRow(listId, rowId) {
  const list = getList(listId);
  if (!list) return;
  list.rows = list.rows.filter(r => r.id !== rowId);
  if (!list.rows.length) list.rows.push(defaultRow());
  save();
  renderRowsForList(listId);
  recalcList(listId);
}

function updateRow(listId, rowId, field, value) {
  const row = getRow(listId, rowId);
  if (row) { row[field] = value; save(); }
}

function toggleRow(listId, rowId, field) {
  const row = getRow(listId, rowId);
  if (!row) return;
  row[field] = !row[field];
  save();
  renderRowsForList(listId);
  renderArchiveSection(listId);
  recalcList(listId);
}

function handleRowEnter(e, listId, rowId) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const list    = getList(listId);
  const visible = list.rows.filter(r => !r.checked);
  const idx     = visible.findIndex(r => r.id === rowId);
  if (idx === visible.length - 1) {
    addRow(listId);
  } else {
    document.getElementById(`tbody-${listId}`)
      ?.querySelectorAll('tr')[idx + 1]?.querySelector('input')?.focus();
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function formatDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Categories ────────────────────────────────────────────────

const activeCategoryFilter = {};

function renderCategoryFilter(listId) {
  const list      = getList(listId);
  const container = document.getElementById(`category-filter-${listId}`);
  if (!list || !container) return;

  const cats = [...new Set(list.rows.map(r => r.category).filter(Boolean))];
  if (!cats.length) { container.innerHTML = ''; return; }

  const active = activeCategoryFilter[listId] || '';
  container.innerHTML = `
    <div class="category-pills">
      <button class="category-pill${!active ? ' active' : ''}" onclick="setCategoryFilter('${listId}','')">Tout</button>
      ${cats.map(c => `
        <button class="category-pill${active === c ? ' active' : ''}"
          onclick="setCategoryFilter('${listId}','${esc(c)}')">${esc(c)}</button>
      `).join('')}
    </div>
  `;
}

function setCategoryFilter(listId, cat) {
  activeCategoryFilter[listId] = cat;
  renderRowsForList(listId);
  renderCategoryFilter(listId);
}

// ── Archive ───────────────────────────────────────────────────

function renderArchiveSection(listId) {
  const list      = getList(listId);
  const container = document.getElementById(`archive-${listId}`);
  if (!list || !container) return;

  const purchased = list.rows.filter(r => r.checked);
  if (!purchased.length) { container.innerHTML = ''; return; }

  const isOpen   = container.dataset.open === 'true';
  const total    = purchased.reduce((s, r) => s + (parseFloat(r.price)||0)*(parseInt(r.qty)||1), 0);
  const totalStr = total > 0 ? ' · ' + total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €' : '';

  container.innerHTML = `
    <div class="archive-header" onclick="toggleArchive('${listId}')">
      <span class="archive-toggle">${isOpen ? '▼' : '▶'}</span>
      <span class="archive-label">Achats (${purchased.length}${totalStr})</span>
    </div>
    ${isOpen ? `
    <div class="archive-list">
      ${purchased.map(r => `
        <div class="archive-row">
          <span class="archive-name">${esc(r.name)||'—'}</span>
          <span class="archive-price">${r.price
            ? (parseFloat(r.price)*(parseInt(r.qty)||1)).toLocaleString('fr-FR',{maximumFractionDigits:2})+' €'
            : '—'}</span>
          ${!readOnlyMode
            ? `<button class="archive-restore" onclick="toggleRow('${listId}','${r.id}','checked')" title="Remettre">↩</button>`
            : ''}
        </div>
      `).join('')}
    </div>` : ''}
  `;
}

function toggleArchive(listId) {
  const c = document.getElementById(`archive-${listId}`);
  if (!c) return;
  c.dataset.open = c.dataset.open === 'true' ? 'false' : 'true';
  renderArchiveSection(listId);
}

// ── Graph ─────────────────────────────────────────────────────

function renderGraph(listId) {
  const list      = getList(listId);
  const container = document.getElementById(`graph-${listId}`);
  if (!list || !container) return;

  const monthly = parseFloat(list.monthlySavings) || 0;
  const saved   = parseFloat(list.alreadySaved)   || 0;
  const total   = list.rows.filter(r => !r.checked)
    .reduce((s, r) => s + (parseFloat(r.price)||0)*(parseInt(r.qty)||1), 0);

  if (!monthly || !total) { container.innerHTML = ''; return; }

  const bars = Array.from({ length: 6 }, (_, i) => {
    const m         = i + 1;
    const projected = saved + monthly * m;
    const pct       = Math.min(100, (projected / total) * 100);
    return { m, pct, reached: projected >= total };
  });

  container.innerHTML = `
    <div class="graph-title">Projection épargne (6 mois)</div>
    <div class="graph-bars">
      ${bars.map(b => `
        <div class="graph-bar-wrap">
          <div class="graph-pct">${Math.round(b.pct)}%</div>
          <div class="graph-bar-track">
            <div class="graph-bar-fill${b.reached ? ' reached' : ''}" style="height:${b.pct}%"></div>
          </div>
          <div class="graph-bar-label">M${b.m}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Render rows ───────────────────────────────────────────────

const sortables = {};

function renderRowsForList(listId) {
  const list  = getList(listId);
  const tbody = document.getElementById(`tbody-${listId}`);
  if (!list || !tbody) return;

  const catFilter = activeCategoryFilter[listId] || '';
  const rows = list.rows
    .filter(r => !r.checked)
    .filter(r => !catFilter || r.category === catFilter)
    .filter(r => {
      if (!searchQuery) return true;
      return [r.name, r.note, r.category].join(' ').toLowerCase().includes(searchQuery);
    });

  tbody.innerHTML = '';

  if (!rows.length && searchQuery) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-search">Aucun résultat pour « ${esc(searchQuery)} »</td></tr>`;
    return;
  }

  rows.forEach(r => {
    const sub    = (parseFloat(r.price)||0) * (parseInt(r.qty)||1);
    const subStr = sub > 0 ? sub.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €' : '—';
    const expanded = isRowExpanded(r);

    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (r.priority) tr.classList.add('is-priority');

    tr.innerHTML = `
      <td class="col-drag">${readOnlyMode ? '' : '<span class="drag-handle">⠿</span>'}</td>
      <td class="col-name">
        <div class="name-row">
          <input class="cell-input" type="text" placeholder="Ex : AirPods Pro" value="${esc(r.name)}"
            oninput="updateRow('${listId}','${r.id}','name',this.value)"
            onkeydown="handleRowEnter(event,'${listId}','${r.id}')"
            ${readOnlyMode ? 'disabled' : ''} />
          ${readOnlyMode ? '' : `
          <button class="expand-row-btn${expanded ? ' open' : ''}"
            onclick="toggleRowExpand('${listId}','${r.id}')" title="Note / Tag / Date">···</button>
          <button class="del-row-btn" onclick="delRow('${listId}','${r.id}')" title="Supprimer">×</button>`}
        </div>
        <div class="url-row">
          <input class="cell-input cell-url" type="url" placeholder="https://…" value="${esc(r.url||'')}"
            oninput="updateRow('${listId}','${r.id}','url',this.value);this.nextElementSibling.classList.toggle('has-url',!!this.value)"
            ${readOnlyMode ? 'disabled' : ''} />
          <button class="open-link-btn${r.url ? ' has-url' : ''}"
            onclick="const u=getRow('${listId}','${r.id}')?.url;if(u)window.open(u,'_blank')" title="Ouvrir">↗</button>
        </div>
        ${expanded ? `
        <div class="meta-row">
          <input class="cell-input cell-note" type="text" placeholder="Note…" value="${esc(r.note||'')}"
            oninput="updateRow('${listId}','${r.id}','note',this.value)"
            ${readOnlyMode ? 'disabled' : ''} />
          <input class="cell-input cell-category" type="text" placeholder="# tag" value="${esc(r.category||'')}"
            oninput="updateRow('${listId}','${r.id}','category',this.value);renderCategoryFilter('${listId}')"
            ${readOnlyMode ? 'disabled' : ''} />
          ${readOnlyMode
            ? (r.targetDate ? `<div class="target-date-badge">📅 ${formatDate(r.targetDate)}</div>` : '')
            : `<input class="cell-date" type="date" value="${esc(r.targetDate||'')}"
                oninput="updateRow('${listId}','${r.id}','targetDate',this.value);renderRowsForList('${listId}')"
                title="Date cible" />`}
        </div>` : (r.targetDate ? `<div class="target-date-badge">📅 ${formatDate(r.targetDate)}</div>` : '')}
      </td>
      <td class="col-price">
        <input class="cell-input" type="number" placeholder="0" value="${esc(r.price)}" min="0" step="1"
          oninput="updateRow('${listId}','${r.id}','price',this.value);recalcList('${listId}')"
          ${readOnlyMode ? 'disabled' : ''} />
      </td>
      <td class="col-qty">
        <input class="cell-input" type="number" placeholder="1" value="${esc(r.qty)}" min="1" step="1"
          oninput="updateRow('${listId}','${r.id}','qty',parseInt(this.value)||1);recalcList('${listId}')"
          ${readOnlyMode ? 'disabled' : ''} />
      </td>
      <td class="col-sub"><span class="row-total">${subStr}</span></td>
      <td class="col-prio">
        <button class="prio-btn${r.priority ? ' is-prio' : ''}"
          onclick="${readOnlyMode ? '' : `toggleRow('${listId}','${r.id}','priority')`}"
          ${readOnlyMode ? 'disabled' : ''} title="Priorité">★</button>
      </td>
      <td class="col-check">
        <button class="check-btn${r.checked ? ' is-checked' : ''}"
          onclick="${readOnlyMode ? '' : `toggleRow('${listId}','${r.id}','checked')`}"
          ${readOnlyMode ? 'disabled' : ''}
          title="${r.checked ? 'Décocher' : 'Marquer acheté'}">${r.checked ? '✓' : ''}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderCategoryFilter(listId);
  if (readOnlyMode) return;

  if (sortables[listId]) sortables[listId].destroy();
  sortables[listId] = Sortable.create(tbody, {
    group: { name: 'rows', pull: true, put: true },
    animation: 150, handle: '.drag-handle', ghostClass: 'drag-ghost',
    onEnd(evt) {
      const fromId = evt.from.closest('[data-list-id]')?.dataset.listId;
      const toId   = evt.to.closest('[data-list-id]')?.dataset.listId;
      const rowId  = evt.item.dataset.id;
      if (!fromId || !toId || !rowId) return;

      if (fromId === toId) {
        const list      = getList(fromId);
        const unchecked = list.rows.filter(r => !r.checked);
        const checked   = list.rows.filter(r => r.checked);
        const [moved]   = unchecked.splice(evt.oldIndex, 1);
        unchecked.splice(evt.newIndex, 0, moved);
        list.rows = [...unchecked, ...checked];
        save();
      } else {
        const fromList = getList(fromId);
        const toList   = getList(toId);
        const idx      = fromList.rows.findIndex(r => r.id === rowId);
        if (idx !== -1 && toList) {
          const [moved] = fromList.rows.splice(idx, 1);
          if (!fromList.rows.filter(r => !r.checked).length) fromList.rows.push(defaultRow());
          toList.rows.splice(evt.newIndex, 0, moved);
          save();
          renderRowsForList(fromId);
          renderRowsForList(toId);
          recalcList(fromId);
          recalcList(toId);
        }
      }
    }
  });
}

// ── Recalc ────────────────────────────────────────────────────

function recalcList(listId) {
  const list = getList(listId);
  const el   = id => document.getElementById(`${id}-${listId}`);
  if (!list || !el('s-total')) return;

  const active   = list.rows.filter(r => !r.checked);
  const priority = active.filter(r => r.priority);

  const total     = active.reduce((s, r) => s + (parseFloat(r.price)||0)*(parseInt(r.qty)||1), 0);
  const prioTotal = priority.reduce((s, r) => s + (parseFloat(r.price)||0)*(parseInt(r.qty)||1), 0);

  const saved   = parseFloat(list.alreadySaved)   || 0;
  const monthly = parseFloat(list.monthlySavings) || 0;
  const reste   = Math.max(0, total - saved);

  el('s-total').textContent = total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
  el('s-reste').textContent = reste.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';

  const targetReste = priority.length > 0 ? Math.max(0, prioTotal - saved) : reste;
  let timeText = '—', timeSub = '';

  if (monthly > 0 && targetReste > 0) {
    const months = targetReste / monthly;
    if (months < 1) {
      timeText = '< 1 mois';
    } else if (months < 12) {
      const m = Math.ceil(months);
      timeText = m + ' mois';
      timeSub  = (monthly * m).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' € au total';
    } else {
      const y = Math.floor(months / 12), remM = Math.ceil(months % 12);
      timeText = y + ' an' + (y > 1 ? 's' : '');
      timeSub  = remM > 0 ? 'et ' + remM + ' mois' : 'pile';
    }
    if (priority.length > 0) timeSub += (timeSub ? ' · ' : '') + 'priorités';
  } else if (monthly > 0 && targetReste === 0 && total > 0) {
    timeText = '✓ Atteint'; timeSub = 'Budget suffisant';
  }

  el('s-time').textContent     = timeText;
  el('s-time-sub').textContent = timeSub;

  const pct = total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0;
  el('pct-label').textContent = pct + '%';
  el('bar-fill').style.width  = pct + '%';

  renderGraph(listId);
}

// ── PWA ───────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────
initAuth();
