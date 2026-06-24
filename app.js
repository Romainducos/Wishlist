// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://rlifarrxzugydbfzmhyz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_azmlH82WQ5dKOZ0gmEv7YA_P3m8l3MZ';
// ─────────────────────────────────────────────────────────────

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const LS_PREFIX = 'wishlist_v5_';

let currentUser = null;

// ── State ─────────────────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2, 10); }

function defaultRow() {
  return { id: genId(), name: '', price: '', qty: 1, url: '', checked: false, priority: false, note: '' };
}

function defaultList(name = 'Ma wishlist') {
  return { id: genId(), name, alreadySaved: '', monthlySavings: '', rows: [defaultRow(), defaultRow()] };
}

function defaultState() {
  return { lists: [defaultList()] };
}

let state = defaultState();

function getList(listId) { return state.lists.find(l => l.id === listId); }
function getRow(listId, rowId) { return getList(listId)?.rows.find(r => r.id === rowId); }

function migrate(raw) {
  if (!raw) return defaultState();
  if (raw.rows && !raw.lists) {
    const list = {
      id: genId(), name: 'Ma wishlist',
      alreadySaved: raw.alreadySaved || '',
      monthlySavings: raw.monthlySavings || '',
      rows: (raw.rows || []).map(r => ({
        id: genId(), checked: false, priority: false, note: '', url: '',
        name: r.name || '', price: r.price || '', qty: r.qty || 1, ...r
      }))
    };
    if (!list.rows.length) list.rows.push(defaultRow());
    return { lists: [list] };
  }
  if (raw.lists) {
    raw.lists = raw.lists.map(l => ({
      ...l,
      rows: (l.rows || []).map(r => ({
        id: r.id || genId(), checked: false, priority: false, note: '', url: '', ...r
      }))
    }));
  }
  return raw;
}

// ── Auth ──────────────────────────────────────────────────────

async function initAuth() {
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
    el.textContent = navigator.onLine ? '' : '● Hors ligne';
    el.className = 'conn-status' + (navigator.onLine ? '' : ' offline');
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
  document.getElementById('app').style.display = 'block';
  renderAllLists();
  await loadFromSupabase();
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
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

// ── Render all lists ──────────────────────────────────────────

function renderAllLists() {
  const container = document.getElementById('lists-container');
  container.innerHTML = '';
  state.lists.forEach(list => {
    const section = buildListSection(list);
    container.appendChild(section);
    renderRowsForList(list.id);
    recalcList(list.id);
  });
}

function buildListSection(list) {
  const section = document.createElement('div');
  section.className = 'list-section';
  section.dataset.listId = list.id;

  section.innerHTML = `
    <div class="list-section-header">
      <h2 class="list-section-title">${esc(list.name)}</h2>
      <div class="list-section-actions">${buildListActions(list.id)}</div>
    </div>

    <div class="list-config">
      <div class="config-grid">
        <div class="field">
          <label>Déjà économisé</label>
          <div class="input-wrap">
            <input type="number" value="${esc(list.alreadySaved || '')}" placeholder="0" min="0" step="50"
              oninput="onConfigInput('${list.id}','alreadySaved',this.value)" />
            <span class="unit">€</span>
          </div>
        </div>
        <div class="field">
          <label>Épargne mensuelle</label>
          <div class="input-wrap">
            <input type="number" value="${esc(list.monthlySavings || '')}" placeholder="500" min="0" step="50"
              oninput="onConfigInput('${list.id}','monthlySavings',this.value)" />
            <span class="unit">€/mois</span>
          </div>
        </div>
      </div>
    </div>

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

    <button class="add-btn" onclick="addRow('${list.id}')">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/>
      </svg>
      Ajouter un article
    </button>

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
          <div class="metric-value green" id="s-time-${list.id}">—</div>
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
    </div>
  `;

  return section;
}

// ── Lists CRUD ────────────────────────────────────────────────

function addList() {
  const newList = defaultList('Nouvelle liste');
  state.lists.push(newList);
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
  if (state.lists.length === 1) return;
  const section = document.querySelector(`[data-list-id="${listId}"]`);
  const actions = section?.querySelector('.list-section-actions');
  if (!actions) return;

  actions.innerHTML = `
    <span class="delete-confirm-label">Supprimer ?</span>
    <button class="list-action-btn danger" onclick="confirmDeleteList('${listId}')" title="Oui">Oui</button>
    <button class="list-action-btn" onclick="cancelDelete('${listId}')" title="Non">Non</button>
  `;
}

function confirmDeleteList(listId) {
  state.lists = state.lists.filter(l => l.id !== listId);
  save();
  renderAllLists();
}

function cancelDelete(listId) {
  const section = document.querySelector(`[data-list-id="${listId}"]`);
  const actions = section?.querySelector('.list-section-actions');
  if (actions) actions.innerHTML = buildListActions(listId);
}

function buildListActions(listId) {
  return `
    <button class="list-action-btn" onclick="renameList('${listId}')" title="Renommer">✎</button>
    ${state.lists.length > 1
      ? `<button class="list-action-btn danger" onclick="deleteList('${listId}')" title="Supprimer">🗑</button>`
      : ''}
  `;
}

function onConfigInput(listId, field, value) {
  const list = getList(listId);
  if (list) { list[field] = value; save(); recalcList(listId); }
}

// ── Rows ──────────────────────────────────────────────────────

function addRow(listId) {
  const list = getList(listId);
  if (!list) return;
  const row = defaultRow();
  list.rows.push(row);
  save();
  renderRowsForList(listId);
  recalcList(listId);
  const tbody = document.getElementById(`tbody-${listId}`);
  const last  = tbody?.querySelector('tr:last-child');
  if (last) last.querySelector('input').focus();
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
  recalcList(listId);
}

function handleRowEnter(e, listId, rowId) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const list = getList(listId);
  const idx  = list.rows.findIndex(r => r.id === rowId);
  if (idx === list.rows.length - 1) {
    addRow(listId);
  } else {
    const tbody  = document.getElementById(`tbody-${listId}`);
    const nextTr = tbody?.querySelectorAll('tr')[idx + 1];
    if (nextTr) nextTr.querySelector('input').focus();
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Render rows ───────────────────────────────────────────────

const sortables = {};

function renderRowsForList(listId) {
  const list  = getList(listId);
  const tbody = document.getElementById(`tbody-${listId}`);
  if (!list || !tbody) return;

  tbody.innerHTML = '';
  list.rows.forEach(r => {
    const p      = r.checked ? 0 : (parseFloat(r.price) || 0);
    const sub    = p * (parseInt(r.qty) || 1);
    const subStr = sub > 0
      ? sub.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €' : '—';

    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (r.checked)  tr.classList.add('is-checked');
    if (r.priority) tr.classList.add('is-priority');

    tr.innerHTML = `
      <td class="col-drag"><span class="drag-handle" title="Déplacer">⠿</span></td>
      <td class="col-name">
        <input class="cell-input" type="text" placeholder="Ex : AirPods Pro" value="${esc(r.name)}"
          oninput="updateRow('${listId}','${r.id}','name',this.value)"
          onkeydown="handleRowEnter(event,'${listId}','${r.id}')" />
        <div class="url-row">
          <input class="cell-input cell-url" type="url" placeholder="https://…" value="${esc(r.url || '')}"
            oninput="updateRow('${listId}','${r.id}','url',this.value);this.nextElementSibling.classList.toggle('has-url',!!this.value)" />
          <button class="open-link-btn${r.url ? ' has-url' : ''}"
            onclick="const u=getRow('${listId}','${r.id}')?.url;if(u)window.open(u,'_blank')"
            title="Ouvrir">↗</button>
        </div>
        <input class="cell-input cell-note" type="text" placeholder="Note…" value="${esc(r.note || '')}"
          oninput="updateRow('${listId}','${r.id}','note',this.value)" />
      </td>
      <td class="col-price">
        <input class="cell-input" type="number" placeholder="0" value="${esc(r.price)}" min="0" step="1"
          oninput="updateRow('${listId}','${r.id}','price',this.value);recalcList('${listId}')" />
      </td>
      <td class="col-qty">
        <input class="cell-input" type="number" placeholder="1" value="${esc(r.qty)}" min="1" step="1"
          oninput="updateRow('${listId}','${r.id}','qty',parseInt(this.value)||1);recalcList('${listId}')" />
      </td>
      <td class="col-sub"><span class="row-total">${subStr}</span></td>
      <td class="col-prio">
        <button class="prio-btn${r.priority ? ' is-prio' : ''}"
          onclick="toggleRow('${listId}','${r.id}','priority')" title="Priorité">★</button>
      </td>
      <td class="col-check">
        <button class="check-btn${r.checked ? ' is-checked' : ''}"
          onclick="toggleRow('${listId}','${r.id}','checked')"
          title="${r.checked ? 'Décocher' : 'Marquer acheté'}">${r.checked ? '✓' : ''}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Init Sortable with cross-list group
  if (sortables[listId]) sortables[listId].destroy();
  sortables[listId] = Sortable.create(tbody, {
    group:      { name: 'rows', pull: true, put: true },
    animation:  150,
    handle:     '.drag-handle',
    ghostClass: 'drag-ghost',
    onEnd(evt) {
      const fromListId = evt.from.closest('[data-list-id]')?.dataset.listId;
      const toListId   = evt.to.closest('[data-list-id]')?.dataset.listId;
      const rowId      = evt.item.dataset.id;
      if (!fromListId || !toListId || !rowId) return;

      if (fromListId === toListId) {
        // Reorder within same list
        const list = getList(fromListId);
        const [moved] = list.rows.splice(evt.oldIndex, 1);
        list.rows.splice(evt.newIndex, 0, moved);
        save();
      } else {
        // Move between lists
        const fromList = getList(fromListId);
        const toList   = getList(toListId);
        const idx      = fromList.rows.findIndex(r => r.id === rowId);
        if (idx !== -1 && toList) {
          const [moved] = fromList.rows.splice(idx, 1);
          if (!fromList.rows.length) fromList.rows.push(defaultRow());
          toList.rows.splice(evt.newIndex, 0, moved);
          save();
          renderRowsForList(fromListId);
          renderRowsForList(toListId);
          recalcList(fromListId);
          recalcList(toListId);
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

  const activeRows   = list.rows.filter(r => !r.checked);
  const priorityRows = activeRows.filter(r => r.priority);

  const total = activeRows.reduce((acc, r) =>
    acc + (parseFloat(r.price) || 0) * (parseInt(r.qty) || 1), 0);
  const prioTotal = priorityRows.reduce((acc, r) =>
    acc + (parseFloat(r.price) || 0) * (parseInt(r.qty) || 1), 0);

  const saved   = parseFloat(list.alreadySaved)   || 0;
  const monthly = parseFloat(list.monthlySavings) || 0;
  const reste   = Math.max(0, total - saved);

  el('s-total').textContent = total.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
  el('s-reste').textContent = reste.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';

  const targetReste = priorityRows.length > 0 ? Math.max(0, prioTotal - saved) : reste;
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
      const y    = Math.floor(months / 12);
      const remM = Math.ceil(months % 12);
      timeText   = y + ' an' + (y > 1 ? 's' : '');
      timeSub    = remM > 0 ? 'et ' + remM + ' mois' : 'pile';
    }
    if (priorityRows.length > 0) timeSub += (timeSub ? ' · ' : '') + 'priorités';
  } else if (monthly > 0 && targetReste === 0 && total > 0) {
    timeText = '✓ Atteint'; timeSub = 'Budget suffisant';
  }

  el('s-time').textContent     = timeText;
  el('s-time-sub').textContent = timeSub;

  const pctDone = total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0;
  el('pct-label').textContent = pctDone + '%';
  el('bar-fill').style.width  = pctDone + '%';
}

// ── Init ──────────────────────────────────────────────────────
initAuth();
