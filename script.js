/* ============================================
   MIXVAL — script.js
   ============================================ */

'use strict';

// ============================================
// CONSTANTES
// ============================================

const ELO_NOMES = {
  1: 'Ferro', 2: 'Bronze', 3: 'Prata', 4: 'Ouro', 5: 'Platina',
  6: 'Diamante', 7: 'Ascendente', 8: 'Imortal', 9: 'Radiante'
};

// ============================================
// STATE
// ============================================

let state = {
  banco: [],
  mix: [],
  times: { a: [], b: [], nomeA: 'TIME ALPHA', nomeB: 'TIME OMEGA' },
  mapa: null,
  historico: [],
  editando: null, // { source: 'banco'|'mix', id }
  mapas: ['Ascent', 'Bind', 'Haven', 'Split', 'Lotus', 'Sunset', 'Icebox', 'Fracture', 'Pearl', 'Abyss'],
  vetados: []
};

let currentUser = null;
let authToken = null;
let saveTimer = null;
let lastRemoteState = null;
const DEFAULT_MAPAS = ['Ascent', 'Bind', 'Haven', 'Split', 'Lotus', 'Sunset', 'Icebox', 'Fracture', 'Pearl', 'Abyss'];

// ============================================
// PERSISTÊNCIA
// ============================================

function resetState() {
  state.banco = [];
  state.mix = [];
  state.times = { a: [], b: [], nomeA: 'TIME ALPHA', nomeB: 'TIME OMEGA' };
  state.mapa = null;
  state.historico = [];
  state.editando = null;
  state.mapas = [...DEFAULT_MAPAS];
  state.vetados = [];
}

function userStorageKey(key) {
  return currentUser ? `mixval_${currentUser}_${key}` : `mixval_${key}`;
}

function snapshotState() {
  return {
    banco: state.banco,
    mix: state.mix,
    times: state.times,
    mapa: state.mapa,
    historico: state.historico,
    mapas: state.mapas,
    vetados: state.vetados,
    nomeMix: document.getElementById('mixName')?.value || ''
  };
}

function applySavedState(saved) {
  const next = saved || {};
  state.banco = Array.isArray(next.banco) ? next.banco : [];
  state.mix = Array.isArray(next.mix) ? next.mix : [];
  state.times = next.times || { a: [], b: [], nomeA: 'TIME ALPHA', nomeB: 'TIME OMEGA' };
  state.mapa = next.mapa || null;
  state.historico = Array.isArray(next.historico) ? next.historico : [];
  state.mapas = Array.isArray(next.mapas) ? next.mapas : [...DEFAULT_MAPAS];
  state.vetados = Array.isArray(next.vetados) ? next.vetados : [];
  state.editando = null;
  const mixName = document.getElementById('mixName');
  if (mixName) mixName.value = next.nomeMix || '';
}

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || 'Erro na comunicacao com o servidor.');
  return data;
}

async function syncStateNow() {
  if (!authToken) return;
  const payload = snapshotState();
  const serialized = JSON.stringify(payload);
  if (serialized === lastRemoteState) return;
  lastRemoteState = serialized;
  try {
    await apiRequest('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ state: payload })
    });
  } catch (e) {
    lastRemoteState = null;
    console.error('Erro ao sincronizar com MongoDB:', e);
    toast('Nao foi possivel salvar no MongoDB agora.', 'error');
  }
}

function scheduleRemoteSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncStateNow, 500);
}

function salvarTudo() {
  if (!currentUser) return;
  localStorage.setItem(userStorageKey('banco'), JSON.stringify(state.banco));
  localStorage.setItem(userStorageKey('mix'), JSON.stringify(state.mix));
  localStorage.setItem(userStorageKey('times'), JSON.stringify(state.times));
  localStorage.setItem(userStorageKey('mapa'), state.mapa || '');
  localStorage.setItem(userStorageKey('historico'), JSON.stringify(state.historico));
  localStorage.setItem(userStorageKey('mapas'), JSON.stringify(state.mapas));
  localStorage.setItem(userStorageKey('vetados'), JSON.stringify(state.vetados));
  localStorage.setItem(userStorageKey('nomeMix'), document.getElementById('mixName')?.value || '');
  scheduleRemoteSave();
}

async function carregarTudo() {
  resetState();
  if (!currentUser) return;
  try {
    if (authToken) {
      const remote = await apiRequest('/api/state');
      applySavedState(remote.state);
      lastRemoteState = JSON.stringify(snapshotState());
      return;
    }
  } catch (e) {
    console.error('Erro ao carregar estado do MongoDB:', e);
    toast('Usando dados locais porque o MongoDB nao respondeu.', 'error');
  }

  try {
    applySavedState({
      banco: JSON.parse(localStorage.getItem(userStorageKey('banco')) || '[]'),
      mix: JSON.parse(localStorage.getItem(userStorageKey('mix')) || '[]'),
      times: JSON.parse(localStorage.getItem(userStorageKey('times')) || '{"a":[],"b":[],"nomeA":"TIME ALPHA","nomeB":"TIME OMEGA"}'),
      mapa: localStorage.getItem(userStorageKey('mapa')) || null,
      historico: JSON.parse(localStorage.getItem(userStorageKey('historico')) || '[]'),
      mapas: JSON.parse(localStorage.getItem(userStorageKey('mapas')) || JSON.stringify(DEFAULT_MAPAS)),
      vetados: JSON.parse(localStorage.getItem(userStorageKey('vetados')) || '[]'),
      nomeMix: localStorage.getItem(userStorageKey('nomeMix')) || ''
    });
  } catch (e) {
    console.error('Erro ao carregar cache local:', e);
  }
}

// ============================================
// LOGIN
// ============================================

function normalizeUserName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem('mixval_auth_users') || '{}');
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem('mixval_auth_users', JSON.stringify(users));
}

function applyAuthState() {
  const locked = !currentUser;
  document.body.classList.toggle('auth-locked', locked);
  const pill = document.getElementById('currentUserPill');
  if (pill) pill.textContent = currentUser ? currentUser.toUpperCase() : '';
}

async function loadAppForCurrentUser(initialState = null) {
  if (initialState) {
    applySavedState(initialState);
    lastRemoteState = JSON.stringify(snapshotState());
  } else {
    await carregarTudo();
  }
  setupMixName();
  renderBanco();
  renderMix();
  renderTimes();
  renderResultadoForm();
  renderHistorico();
  renderMapas();
  renderVetos();
}

async function login(userName, password) {
  const user = normalizeUserName(userName);
  if (!user || !password) { toast('Preencha usuario e senha.', 'error'); return; }
  try {
    const data = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({ userName: user, password })
    });
    currentUser = data.userName;
    authToken = data.token;
    localStorage.setItem('mixval_auth_session', currentUser);
    localStorage.setItem('mixval_auth_token', authToken);
    applyAuthState();
    await loadAppForCurrentUser(data.state);
    toast(`Bem-vindo, ${currentUser}!`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function register(userName, password) {
  const user = normalizeUserName(userName);
  if (!user) { toast('Digite um usuario valido.', 'error'); return; }
  if (password.length < 4) { toast('A senha precisa ter 4 caracteres ou mais.', 'error'); return; }
  try {
    const data = await apiRequest('/api/register', {
      method: 'POST',
      body: JSON.stringify({ userName: user, password })
    });
    currentUser = data.userName;
    authToken = data.token;
    localStorage.setItem('mixval_auth_session', currentUser);
    localStorage.setItem('mixval_auth_token', authToken);
    applyAuthState();
    await loadAppForCurrentUser(data.state);
    toast('Conta criada com sucesso!', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function logout() {
  localStorage.removeItem('mixval_auth_session');
  localStorage.removeItem('mixval_auth_token');
  currentUser = null;
  authToken = null;
  lastRemoteState = null;
  clearTimeout(saveTimer);
  resetState();
  applyAuthState();
  renderBanco();
  renderMix();
  renderTimes();
  renderResultadoForm();
  renderHistorico();
  renderMapas();
  renderVetos();
  toast('Voce saiu da conta.', 'info');
}

function setupAuth() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const authToggle = document.getElementById('authToggle');
  const btnLogout = document.getElementById('btnLogout');
  let showingRegister = false;

  currentUser = localStorage.getItem('mixval_auth_session');
  authToken = localStorage.getItem('mixval_auth_token');
  if (!currentUser || !authToken) {
    currentUser = null;
    authToken = null;
  }
  applyAuthState();

  if (loginForm) {
    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      login(document.getElementById('loginUser').value, document.getElementById('loginPass').value);
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', e => {
      e.preventDefault();
      register(document.getElementById('registerUser').value, document.getElementById('registerPass').value);
    });
  }

  if (authToggle) {
    authToggle.addEventListener('click', () => {
      showingRegister = !showingRegister;
      if (loginForm) loginForm.style.display = showingRegister ? 'none' : '';
      if (registerForm) registerForm.style.display = showingRegister ? '' : 'none';
      authToggle.textContent = showingRegister ? 'Ja tenho conta' : 'Criar nova conta';
    });
  }

  if (btnLogout) btnLogout.addEventListener('click', logout);
}

// ============================================
// UTILS
// ============================================

let toastTimer = null;

function toast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  if (!el) return; // Se elemento não existir, sair sem erro
  el.textContent = msg;
  el.className = `toast show ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function uid() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function eloBadge(elo) {
  const num = parseInt(elo);
  return `<span class="elo-badge elo-${num}">${ELO_NOMES[num] || '?'}</span>`;
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function calcKDA(k, d, a) {
  const kills = parseInt(k) || 0;
  const deaths = parseInt(d) || 0;
  const assists = parseInt(a) || 0;
  return ((kills + assists) / Math.max(1, deaths)).toFixed(2);
}

// ============================================
// TABS
// ============================================

function setupTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  if (btns.length === 0) return; // Se não houver botões de aba, sair
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const tabPanel = document.getElementById('tab-' + btn.dataset.tab);
      if (tabPanel) tabPanel.classList.add('active');
    });
  });
}

// ============================================
// MIX NAME
// ============================================

function setupMixName() {
  const input = document.getElementById('mixName');
  if (!input) return; // Se elemento não existir, sair sem erro
  if (input.dataset.bound === 'true') return;
  input.dataset.bound = 'true';
  input.addEventListener('input', () => {
    salvarTudo();
  });
}

// ============================================
// BANCO DE JOGADORES
// ============================================

function renderBanco() {
  const lista = document.getElementById('bancoLista');
  const empty = document.getElementById('bancoEmpty');
  const count = document.getElementById('bancoCount');
  
  if (!lista || !empty || !count) return; // Proteção contra elementos faltantes

  count.textContent = `${state.banco.length} no banco`;

  // clear (keep empty state element)
  while (lista.children.length > 1) lista.removeChild(lista.lastChild);

  if (state.banco.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  state.banco.forEach(jogador => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-avatar">${initials(jogador.nome)}</div>
      <div class="player-info">
        <div class="player-name">${escHtml(jogador.nome)}</div>
        ${eloBadge(jogador.elo)}
      </div>
      <div class="player-actions">
        <button class="btn-icon" title="Adicionar ao mix" data-id="${jogador.id}" data-action="addMix">+MIX</button>
        <button class="btn-icon" title="Editar" data-id="${jogador.id}" data-action="edit">✏</button>
        <button class="btn-icon danger" title="Remover" data-id="${jogador.id}" data-action="removeBanco">✕</button>
      </div>
    `;
    lista.appendChild(card);
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function adicionarAoBanco() {
  const nome = document.getElementById('bancoNome').value.trim();
  const elo = parseInt(document.getElementById('bancoElo').value);
  if (!nome) { toast('Digite um nome!', 'error'); return; }
  if (state.banco.find(j => j.nome.toLowerCase() === nome.toLowerCase())) {
    toast('Jogador já existe no banco!', 'error'); return;
  }
  state.banco.push({ id: uid(), nome, elo });
  document.getElementById('bancoNome').value = '';
  salvarTudo();
  renderBanco();
  toast(`${nome} adicionado ao banco!`, 'success');
}

function removerDoBanco(id) {
  state.banco = state.banco.filter(j => j.id !== id);
  salvarTudo();
  renderBanco();
  toast('Jogador removido do banco.', 'info');
}

function adicionarAoMixDoBanco(id) {
  const jogador = state.banco.find(j => j.id === id);
  if (!jogador) return;
  if (state.mix.find(j => j.nome.toLowerCase() === jogador.nome.toLowerCase())) {
    toast(`${jogador.nome} já está no mix!`, 'error'); return;
  }
  state.mix.push({ id: uid(), nome: jogador.nome, elo: jogador.elo });
  salvarTudo();
  renderMix();
  toast(`${jogador.nome} adicionado ao mix!`, 'success');
}

function adicionarTodosAoMix() {
  if (state.banco.length === 0) { toast('Banco vazio!', 'error'); return; }
  let count = 0;
  state.banco.forEach(jogador => {
    if (!state.mix.find(j => j.nome.toLowerCase() === jogador.nome.toLowerCase())) {
      state.mix.push({ id: uid(), nome: jogador.nome, elo: jogador.elo });
      count++;
    }
  });
  salvarTudo();
  renderMix();
  toast(`${count} jogadores adicionados ao mix!`, 'success');
}

// ============================================
// MIX ATUAL
// ============================================

function renderMix() {
  const lista = document.getElementById('mixLista');
  const empty = document.getElementById('mixEmpty');
  
  if (!lista || !empty) return; // Proteção contra elementos faltantes

  while (lista.children.length > 1) lista.removeChild(lista.lastChild);

  // Update header count badge
  const badge = document.getElementById('playerCountBadge');
  if (badge) badge.textContent = `${state.mix.length} jogadores`;

  // Update stats bar
  const countNum = document.getElementById('mixCountNum');
  const eloTotal = document.getElementById('mixEloTotal');
  const eloMedio = document.getElementById('mixEloMedio');
  
  if (countNum) countNum.textContent = state.mix.length;
  if (state.mix.length > 0) {
    const total = state.mix.reduce((s, j) => s + parseInt(j.elo), 0);
    const medio = (total / state.mix.length).toFixed(1);
    if (eloTotal) eloTotal.textContent = total;
    if (eloMedio) eloMedio.textContent = medio;
  } else {
    if (eloTotal) eloTotal.textContent = '—';
    if (eloMedio) eloMedio.textContent = '—';
  }

  if (state.mix.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  state.mix.forEach(jogador => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-avatar">${initials(jogador.nome)}</div>
      <div class="player-info">
        <div class="player-name">${escHtml(jogador.nome)}</div>
        ${eloBadge(jogador.elo)}
      </div>
      <div class="player-actions">
        <button class="btn-icon" title="Editar elo" data-id="${jogador.id}" data-action="editMix">✏</button>
        <button class="btn-icon danger" title="Remover" data-id="${jogador.id}" data-action="removeMix">✕</button>
      </div>
    `;
    lista.appendChild(card);
  });
}

function adicionarManualMix() {
  const nome = document.getElementById('mixNomeManual').value.trim();
  const elo = parseInt(document.getElementById('mixEloManual').value);
  if (!nome) { toast('Digite um nome!', 'error'); return; }
  if (state.mix.find(j => j.nome.toLowerCase() === nome.toLowerCase())) {
    toast('Jogador já está no mix!', 'error'); return;
  }
  state.mix.push({ id: uid(), nome, elo });
  document.getElementById('mixNomeManual').value = '';
  salvarTudo();
  renderMix();
  toast(`${nome} adicionado ao mix!`, 'success');
}

function removerDoMix(id) {
  state.mix = state.mix.filter(j => j.id !== id);
  salvarTudo();
  renderMix();
  toast('Jogador removido do mix.', 'info');
}

function resetarMix() {
  if (!confirm('Resetar a lista do mix atual?')) return;
  state.mix = [];
  state.times = { a: [], b: [], nomeA: 'TIME ALPHA', nomeB: 'TIME OMEGA' };
  salvarTudo();
  renderMix();
  renderTimes();
  renderResultadoForm();
  toast('Mix resetado!', 'info');
}

// ============================================
// BALANCEAMENTO DE TIMES
// ============================================

function gerarTimes() {
  if (state.mix.length < 2) {
    toast('Adicione pelo menos 2 jogadores ao mix!', 'error'); return;
  }

  const jogadores = [...state.mix];
  const n = jogadores.length;
  const metade = Math.floor(n / 2);

  // Gerar múltiplas combinações e escolher a mais equilibrada
  let melhorDiff = Infinity;
  let melhorA = [];
  let melhorB = [];

  // Embaralhar e tentar várias vezes
  const tentativas = Math.min(500, Math.pow(2, n));

  for (let t = 0; t < tentativas; t++) {
    // Fisher-Yates shuffle
    const shuffled = [...jogadores];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const timeA = shuffled.slice(0, metade);
    const timeB = shuffled.slice(metade);

    const somaA = timeA.reduce((s, j) => s + parseInt(j.elo), 0);
    const somaB = timeB.reduce((s, j) => s + parseInt(j.elo), 0);
    const diff = Math.abs(somaA - somaB);

    if (diff < melhorDiff) {
      melhorDiff = diff;
      melhorA = timeA;
      melhorB = timeB;
      if (diff === 0) break;
    }
  }

  state.times.a = melhorA;
  state.times.b = melhorB;
  salvarTudo();
  renderTimes();
  renderResultadoForm();
  toast('Times gerados!', 'success');
}

function renderTimes() {
  const display = document.getElementById('timesDisplay');
  const empty = document.getElementById('timesEmpty');

  if (!display || !empty) return; // Proteção contra elementos faltantes

  if (!state.times.a || state.times.a.length === 0) {
    display.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  display.style.display = 'grid';
  empty.style.display = 'none';

  // Time A
  const nomeTimeA = document.getElementById('nomeTimeA');
  const nomeTimeB = document.getElementById('nomeTimeB');
  if (nomeTimeA) nomeTimeA.value = state.times.nomeA;
  if (nomeTimeB) nomeTimeB.value = state.times.nomeB;

  const somaA = state.times.a.reduce((s, j) => s + parseInt(j.elo), 0);
  const somaB = state.times.b.reduce((s, j) => s + parseInt(j.elo), 0);
  const diff = Math.abs(somaA - somaB);

  const eloTimeA = document.getElementById('eloTimeA');
  const eloTimeB = document.getElementById('eloTimeB');
  if (eloTimeA) eloTimeA.textContent = `ELO: ${somaA}`;
  if (eloTimeB) eloTimeB.textContent = `ELO: ${somaB}`;

  // Diff indicator
  const diffEl = document.getElementById('diffIndicador');
  const diffNum = document.getElementById('diffNum');
  const diffLabel = document.getElementById('diffLabel');
  if (diffNum) diffNum.textContent = diff;
  if (diffEl) {
    diffEl.className = 'diff-indicator';
    if (diff <= 1) {
      if (diffLabel) diffLabel.textContent = 'EQUILIBRADO';
      diffEl.classList.add('diff-good');
    } else if (diff <= 3) {
      if (diffLabel) diffLabel.textContent = 'LEVE DESBALANCEIO';
      diffEl.classList.add('diff-ok');
    } else {
      if (diffLabel) diffLabel.textContent = 'DESBALANCEADO';
      diffEl.classList.add('diff-bad');
    }
  }

  // Players Time A
  const listaA = document.getElementById('listaTimeA');
  if (listaA) {
    listaA.innerHTML = '';
    state.times.a.forEach(j => {
      const li = document.createElement('li');
      li.className = 'team-player-item';
      li.innerHTML = `
        <div class="player-avatar" style="width:30px;height:30px;font-size:0.8rem">${initials(j.nome)}</div>
        <span class="player-name">${escHtml(j.nome)}</span>
        ${eloBadge(j.elo)}
      `;
      listaA.appendChild(li);
    });
  }

  // Players Time B
  const listaB = document.getElementById('listaTimeB');
  if (listaB) {
    listaB.innerHTML = '';
    state.times.b.forEach(j => {
      const li = document.createElement('li');
      li.className = 'team-player-item';
      li.innerHTML = `
        <div class="player-avatar" style="width:30px;height:30px;font-size:0.8rem">${initials(j.nome)}</div>
        <span class="player-name">${escHtml(j.nome)}</span>
        ${eloBadge(j.elo)}
      `;
      listaB.appendChild(li);
    });
  }

  // Mapa
  const mapaDisplay = document.getElementById('mapaDisplay');
  if (mapaDisplay) mapaDisplay.textContent = state.mapa || '—';
}

function sortearMapa() {
  const disponiveis = state.mapas.filter(m => !state.vetados.includes(m));
  if (disponiveis.length === 0) {
    toast('Todos os mapas foram vetados!', 'error');
    return;
  }
  const mapa = disponiveis[Math.floor(Math.random() * disponiveis.length)];
  state.mapa = mapa;
  const mapaDisplay = document.getElementById('mapaDisplay');
  if (mapaDisplay) mapaDisplay.textContent = mapa;
  salvarTudo();
  toast(`Mapa: ${mapa}!`, 'success');
}

function adicionarMapa() {
  const input = document.getElementById('novoMapaInput');
  if (!input) return;
  const novoMapa = input.value.trim().toUpperCase();
  if (!novoMapa) {
    toast('Digite um nome de mapa!', 'error');
    return;
  }
  if (state.mapas.includes(novoMapa)) {
    toast('Mapa já existe!', 'error');
    return;
  }
  state.mapas.push(novoMapa);
  input.value = '';
  salvarTudo();
  renderMapas();
  renderVetos();
  toast(`${novoMapa} adicionado!`, 'success');
}

function removerMapa(mapa) {
  if (!confirm(`Remover ${mapa} da lista?`)) return;
  state.mapas = state.mapas.filter(m => m !== mapa);
  state.vetados = state.vetados.filter(m => m !== mapa);
  if (state.mapa === mapa) state.mapa = null;
  salvarTudo();
  renderMapas();
  renderVetos();
  toast(`${mapa} removido!`, 'info');
}

function toggleVeto(mapa) {
  if (state.vetados.includes(mapa)) {
    state.vetados = state.vetados.filter(m => m !== mapa);
    toast(`${mapa} devetado!`, 'info');
  } else {
    state.vetados.push(mapa);
    toast(`${mapa} vetado!`, 'info');
  }
  salvarTudo();
  renderMapas();
}

function renderMapas() {
  const lista = document.getElementById('mapasList');
  if (!lista) return;
  
  lista.innerHTML = '';
  state.mapas.forEach(mapa => {
    const item = document.createElement('div');
    item.className = 'mapa-item';
    const isVetado = state.vetados.includes(mapa);
    item.innerHTML = `
      <span class="mapa-name" style="${isVetado ? 'opacity: 0.5; text-decoration: line-through;' : ''}">${escHtml(mapa)}</span>
      <div class="mapa-actions">
        <button class="btn-icon" title="Vetar/Devetar" data-mapa="${mapa}" data-action="toggleVeto" style="${isVetado ? 'color: #ff4444;' : ''}">${isVetado ? '✓' : '🚫'}</button>
        <button class="btn-icon danger" title="Remover" data-mapa="${mapa}" data-action="removerMapa">✕</button>
      </div>
    `;
    lista.appendChild(item);
  });
}

// ============================================
// PÓS-PARTIDA
// ============================================

function renderResultadoForm() {
  const info = document.getElementById('resultadoInfo');
  const form = document.getElementById('resultadoForm');

  if (!info || !form) return; // Proteção contra elementos faltantes

  if (!state.times.a || state.times.a.length === 0) {
    info.style.display = 'block';
    form.style.display = 'none';
    return;
  }

  info.style.display = 'none';
  form.style.display = 'block';

  const resultadoTimeALabel = document.getElementById('resultadoTimeALabel');
  const resultadoTimeBLabel = document.getElementById('resultadoTimeBLabel');
  if (resultadoTimeALabel) resultadoTimeALabel.textContent = state.times.nomeA || 'TIME A';
  if (resultadoTimeBLabel) resultadoTimeBLabel.textContent = state.times.nomeB || 'TIME B';

  renderStatsTable('statsBodyA', state.times.a);
  renderStatsTable('statsBodyB', state.times.b);
}

function renderStatsTable(tbodyId, jogadores) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return; // Proteção contra elemento faltante
  
  tbody.innerHTML = '';
  jogadores.forEach(j => {
    const tr = document.createElement('tr');
    tr.dataset.playerId = j.id;
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:0.4rem">
          ${eloBadge(j.elo)}
          <span style="font-family:var(--font-display);font-weight:600">${escHtml(j.nome)}</span>
        </div>
      </td>
      <td><input type="number" min="0" max="99" value="0" class="stat-k" /></td>
      <td><input type="number" min="0" max="99" value="0" class="stat-d" /></td>
      <td><input type="number" min="0" max="99" value="0" class="stat-a" /></td>
      <td><input type="number" min="0" max="20" value="0" class="stat-fb" /></td>
      <td><span class="kda-auto">1.00</span></td>
    `;
    // Live KDA update
    const inputs = tr.querySelectorAll('.stat-k, .stat-d, .stat-a');
    const kdaSpan = tr.querySelector('.kda-auto');
    inputs.forEach(inp => {
      inp.addEventListener('input', () => {
        const k = tr.querySelector('.stat-k').value;
        const d = tr.querySelector('.stat-d').value;
        const a = tr.querySelector('.stat-a').value;
        kdaSpan.textContent = calcKDA(k, d, a);
      });
    });
    tbody.appendChild(tr);
  });
}

function coletarStats(tbodyId, jogadores, time) {
  const tbody = document.getElementById(tbodyId);
  const rows = tbody.querySelectorAll('tr');
  const stats = [];
  rows.forEach((tr, i) => {
    const j = jogadores[i];
    if (!j) return;
    const k = parseInt(tr.querySelector('.stat-k').value) || 0;
    const d = parseInt(tr.querySelector('.stat-d').value) || 0;
    const a = parseInt(tr.querySelector('.stat-a').value) || 0;
    const fb = parseInt(tr.querySelector('.stat-fb').value) || 0;
    stats.push({
      id: j.id, nome: j.nome, elo: j.elo, time,
      kills: k, deaths: d, assists: a,
      kda: parseFloat(calcKDA(k, d, a)),
      firstBlood: fb
    });
  });
  return stats;
}

function salvarPartida() {
  if (!state.times.a || state.times.a.length === 0) {
    toast('Gere os times primeiro!', 'error'); return;
  }

  const statsA = coletarStats('statsBodyA', state.times.a, state.times.nomeA || 'Time A');
  const statsB = coletarStats('statsBodyB', state.times.b, state.times.nomeB || 'Time B');

  const resultadoVencedorEl = document.querySelector('input[name="resultadoVencedor"]:checked');
  const resultadoVencedor = resultadoVencedorEl ? resultadoVencedorEl.value : 'A';
  
  let vencedor, perdedor;
  if (resultadoVencedor === 'A') {
    vencedor = state.times.nomeA || 'Time A';
    perdedor = state.times.nomeB || 'Time B';
  } else if (resultadoVencedor === 'B') {
    vencedor = state.times.nomeB || 'Time B';
    perdedor = state.times.nomeA || 'Time A';
  } else {
    vencedor = 'EMPATE';
    perdedor = 'EMPATE';
  }

  const partida = {
    id: uid(),
    nomeMix: document.getElementById('mixName').value.trim() || 'Mix sem nome',
    data: new Date().toISOString(),
    mapa: state.mapa || 'Não sorteado',
    nomeTimeA: state.times.nomeA || 'Time A',
    nomeTimeB: state.times.nomeB || 'Time B',
    placarA: parseInt(document.getElementById('placarA').value)||0,
    placarB: parseInt(document.getElementById('placarB').value)||0,
    vencedor: vencedor,
    perdedor: perdedor,
    jogadores: [...statsA, ...statsB]
  };

  state.historico.unshift(partida);
  salvarTudo();
  renderHistorico();
  renderVetos();
  toast('Partida salva no histórico!', 'success');
}

// ============================================
// HISTÓRICO
// ============================================

function renderHistorico() {
  const lista = document.getElementById('historicoLista');
  if (!lista) return; // Proteção contra elemento faltante
  
  lista.innerHTML = '';

  if (state.historico.length === 0) {
    lista.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Nenhuma partida registrada ainda.</p></div>`;
    return;
  }

  state.historico.forEach(partida => {
    const jogadoresA = partida.jogadores.filter(j => j.time === partida.nomeTimeA);
    const jogadoresB = partida.jogadores.filter(j => j.time === partida.nomeTimeB);

    const card = document.createElement('div');
    card.className = 'historico-card';
    card.innerHTML = `
      <div class="historico-card-header">
        <div class="hist-mix-name">${escHtml(partida.nomeMix)}</div>
        <div class="hist-meta">
          <span class="hist-mapa">${escHtml(partida.mapa)}</span>
          <span class="hist-date">${formatDate(partida.data)}</span>
          <button class="btn-icon danger" data-hist-id="${partida.id}" data-action="deleteHist">🗑</button>
        </div>
      </div>
      <div class="score-line">${partida.nomeTimeA} ${partida.placarA} x ${partida.placarB} ${partida.nomeTimeB}</div>
      <div><span class="winner-badge">🏆 ${partida.vencedor}</span> <span class="loser-badge">❌ ${partida.perdedor}</span></div>
      <div class="historico-card-body">
        <div class="hist-team">
          <div class="hist-team-name">${escHtml(partida.nomeTimeA)}</div>
          ${jogadoresA.map(j => playerHistRow(j)).join('')}
        </div>
        <div class="hist-team">
          <div class="hist-team-name" style="color:var(--cyan)">${escHtml(partida.nomeTimeB)}</div>
          ${jogadoresB.map(j => playerHistRow(j)).join('')}
        </div>
      </div>
    `;
    lista.appendChild(card);
  });
}

function playerHistRow(j) {
  return `
    <div class="hist-player-row">
      ${eloBadge(j.elo)}
      <span class="hist-player-name">${escHtml(j.nome)}</span>
      <span class="hist-kda">${j.kills}/${j.deaths}/${j.assists}</span>
      <span class="hist-kda-val">${j.kda}</span>
      <span class="hist-fb" title="First Bloods">🔥 ${j.firstBlood}</span>
    </div>
  `;
}

function deletarPartida(id) {
  if (!confirm('Excluir esta partida do histórico?')) return;
  state.historico = state.historico.filter(p => p.id !== id);
  salvarTudo();
  renderHistorico();
  toast('Partida excluída.', 'info');
}

function limparHistorico() {
  if (!confirm('Limpar TODO o histórico de partidas? Esta ação é irreversível.')) return;
  state.historico = [];
  salvarTudo();
  renderHistorico();
  toast('Histórico limpo.', 'info');
}

// ============================================
// MODAL EDITAR
// ============================================

function abrirModal(source, id) {
  state.editando = { source, id };
  const jogador = source === 'banco'
    ? state.banco.find(j => j.id === id)
    : state.mix.find(j => j.id === id);
  if (!jogador) return;
  
  const editNome = document.getElementById('editNome');
  const editElo = document.getElementById('editElo');
  const modalOverlay = document.getElementById('modalOverlay');
  
  if (!editNome || !editElo || !modalOverlay) return; // Proteção contra elementos faltantes
  
  editNome.value = jogador.nome;
  editElo.value = jogador.elo;
  modalOverlay.style.display = 'flex';
  editNome.focus();
}

function fecharModal() {
  const modalOverlay = document.getElementById('modalOverlay');
  if (modalOverlay) modalOverlay.style.display = 'none';
  state.editando = null;
}

function salvarEdicao() {
  if (!state.editando) return;
  const nome = document.getElementById('editNome').value.trim();
  const elo = parseInt(document.getElementById('editElo').value);
  if (!nome) { toast('Nome não pode ser vazio!', 'error'); return; }

  const { source, id } = state.editando;
  const arr = source === 'banco' ? state.banco : state.mix;
  const idx = arr.findIndex(j => j.id === id);
  if (idx === -1) { toast('Jogador não encontrado!', 'error'); fecharModal(); return; }
  
  arr[idx].nome = nome;
  arr[idx].elo = elo;

  salvarTudo();
  fecharModal();
  if (source === 'banco') { renderBanco(); toast('Jogador editado no banco!', 'success'); }
  else { renderMix(); toast('Jogador editado no mix!', 'success'); }
}

// ============================================
// EVENT DELEGATION
// ============================================

function setupEventDelegation() {
  // Validar se elementos existem antes de adicionar listeners
  const nomeTimeA = document.getElementById('nomeTimeA');
  const nomeTimeB = document.getElementById('nomeTimeB');
  const bancoLista = document.getElementById('bancoLista');
  const mixLista = document.getElementById('mixLista');
  const historicoLista = document.getElementById('historicoLista');
  const modalOverlay = document.getElementById('modalOverlay');
  const editNome = document.getElementById('editNome');
  const bancoNome = document.getElementById('bancoNome');
  const mixNomeManual = document.getElementById('mixNomeManual');

  // Banco lista
  if (bancoLista) {
    bancoLista.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'addMix') adicionarAoMixDoBanco(id);
      else if (action === 'edit') abrirModal('banco', id);
      else if (action === 'removeBanco') removerDoBanco(id);
    });
  }

  // Mix lista
  if (mixLista) {
    mixLista.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'editMix') abrirModal('mix', id);
      else if (action === 'removeMix') removerDoMix(id);
    });
  }

  // Histórico
  if (historicoLista) {
    historicoLista.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'deleteHist') deletarPartida(btn.dataset.histId);
    });
  }

  // Nomes dos times
  if (nomeTimeA) {
    nomeTimeA.addEventListener('input', e => {
      state.times.nomeA = e.target.value || 'TIME ALPHA';
      salvarTudo();
    });
  }
  if (nomeTimeB) {
    nomeTimeB.addEventListener('input', e => {
      state.times.nomeB = e.target.value || 'TIME OMEGA';
      salvarTudo();
    });
  }

  // Enter nos inputs do banco
  if (bancoNome) {
    bancoNome.addEventListener('keydown', e => {
      if (e.key === 'Enter') adicionarAoBanco();
    });
  }
  if (mixNomeManual) {
    mixNomeManual.addEventListener('keydown', e => {
      if (e.key === 'Enter') adicionarManualMix();
    });
  }
  if (editNome) {
    editNome.addEventListener('keydown', e => {
      if (e.key === 'Enter') salvarEdicao();
    });
  }

  // Fechar modal ao clicar fora
  if (modalOverlay) {
    modalOverlay.addEventListener('click', e => {
      if (e.target === modalOverlay) fecharModal();
    });
  }

  // Escape fecha modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fecharModal();
  });

  // Mapas lista
  const mapasList = document.getElementById('mapasList');
  if (mapasList) {
    mapasList.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const mapa = btn.dataset.mapa;
      const action = btn.dataset.action;
      if (action === 'toggleVeto') toggleVeto(mapa);
      else if (action === 'removerMapa') removerMapa(mapa);
    });
  }

  // Enter no input de novo mapa
  const novoMapaInput = document.getElementById('novoMapaInput');
  if (novoMapaInput) {
    novoMapaInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') adicionarMapa();
    });
  }
}

function setupButtons() {
  const buttons = {
    btnAdicionarBanco: adicionarAoBanco,
    btnAdicionarTodos: adicionarTodosAoMix,
    btnAdicionarManual: adicionarManualMix,
    btnResetarMix: resetarMix,
    btnGerarTimes: gerarTimes,
    btnRefazerTimes: gerarTimes,
    btnSortearMapa: sortearMapa,
    btnAdicionarMapa: adicionarMapa,
    btnSalvarPartida: salvarPartida,
    btnSalvarEdicao: salvarEdicao,
    btnCancelarEdicao: fecharModal,
    btnLimparHistorico: limparHistorico
  };
  
  for (const [id, handler] of Object.entries(buttons)) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  }
}

// ============================================
// INIT
// ============================================

async function init() {
  setupAuth();
  setupTabs();
  setupEventDelegation();
  setupButtons();
  if (currentUser) await loadAppForCurrentUser();
}

document.addEventListener('DOMContentLoaded', init);

function renderVetos() {
  const el = document.getElementById('mapVetos');
  if (!el) return;
  el.innerHTML = state.mapas.map(m => `
    <label class="map-veto-item">
      <input type="checkbox" class="map-veto-check" value="${escHtml(m)}" ${state.vetados.includes(m) ? 'checked' : ''} /> ${escHtml(m)}
    </label>
  `).join('');

  el.querySelectorAll('.map-veto-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const val = e.target.value;
      if (e.target.checked) {
        if (!state.vetados.includes(val)) state.vetados.push(val);
      } else {
        state.vetados = state.vetados.filter(m => m !== val);
      }
      salvarTudo();
      renderMapas();
    });
  });
}
