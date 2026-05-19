import React, { Component, useEffect, useMemo, useRef, useState } from 'react';

const ELOS = {
  1: 'Ferro',
  2: 'Bronze',
  3: 'Prata',
  4: 'Ouro',
  5: 'Platina',
  6: 'Diamante',
  7: 'Ascendente',
  8: 'Imortal',
  9: 'Radiante'
};

const DEFAULT_STATE = {
  banco: [],
  mix: [],
  times: { a: [], b: [], nomeA: 'TIME ALPHA', nomeB: 'TIME OMEGA' },
  mapa: null,
  historico: [],
  mapas: ['Ascent', 'Bind', 'Haven', 'Split', 'Lotus', 'Sunset', 'Icebox', 'Fracture', 'Pearl', 'Abyss'],
  vetados: [],
  nomeMix: ''
};

const tabs = [
  ['banco', 'Banco'],
  ['mix', 'Mix atual'],
  ['times', 'Times'],
  ['resultado', 'Pos-partida'],
  ['historico', 'Historico']
];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalizeUserName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function initials(name) {
  return name.split(' ').filter(Boolean).map(word => word[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function eloTotal(players) {
  return players.reduce((sum, player) => sum + Number(player.elo || 0), 0);
}

function calcKda(kills, deaths, assists) {
  return ((Number(kills || 0) + Number(assists || 0)) / Math.max(1, Number(deaths || 0))).toFixed(2);
}

function formatDate(value) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function apiRequest(path, options = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || 'Erro na comunicacao com o servidor.');
  return data;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('mixval_auth_token') || '');
  const [user, setUser] = useState(() => localStorage.getItem('mixval_auth_session') || '');
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ userName: '', password: '' });
  const [state, setState] = useState(DEFAULT_STATE);
  const [activeTab, setActiveTab] = useState('banco');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState('idle');
  const [editing, setEditing] = useState(null);
  const firstSave = useRef(true);

  const notify = (message, type = 'info') => {
    setToast({ message, type });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiRequest('/api/state', {}, token)
      .then(data => setState({ ...DEFAULT_STATE, ...(data.state || {}) }))
      .catch(error => {
        notify(error.message, 'error');
        logout();
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token || loading) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaving('saving');
    const timer = window.setTimeout(() => {
      apiRequest('/api/state', {
        method: 'PUT',
        body: JSON.stringify({ state })
      }, token)
        .then(() => setSaving('saved'))
        .catch(error => {
          setSaving('error');
          notify(error.message, 'error');
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state, token, loading]);

  const mixStats = useMemo(() => {
    const total = eloTotal(state.mix);
    return {
      count: state.mix.length,
      total,
      average: state.mix.length ? (total / state.mix.length).toFixed(1) : '-'
    };
  }, [state.mix]);

  async function submitAuth(event) {
    event.preventDefault();
    const userName = normalizeUserName(authForm.userName);
    if (!userName || !authForm.password) {
      notify('Preencha usuario e senha.', 'error');
      return;
    }

    try {
      const data = await apiRequest(authMode === 'login' ? '/api/login' : '/api/register', {
        method: 'POST',
        body: JSON.stringify({ userName, password: authForm.password })
      });
      localStorage.setItem('mixval_auth_session', data.userName);
      localStorage.setItem('mixval_auth_token', data.token);
      firstSave.current = true;
      setUser(data.userName);
      setToken(data.token);
      setState({ ...DEFAULT_STATE, ...(data.state || {}) });
      notify(authMode === 'login' ? 'Login realizado.' : 'Conta criada.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function logout() {
    localStorage.removeItem('mixval_auth_session');
    localStorage.removeItem('mixval_auth_token');
    setToken('');
    setUser('');
    setState(DEFAULT_STATE);
    setAuthForm({ userName: '', password: '' });
    setActiveTab('banco');
    firstSave.current = true;
  }

  function updateState(patch) {
    setState(current => ({ ...current, ...patch }));
  }

  function addPlayerToBank(player) {
    const name = player.nome.trim();
    if (!name) return notify('Digite um nome.', 'error');
    if (state.banco.some(item => item.nome.toLowerCase() === name.toLowerCase())) {
      return notify('Jogador ja existe no banco.', 'error');
    }
    updateState({ banco: [...state.banco, { id: uid(), nome: name, elo: Number(player.elo) }] });
    notify(`${name} adicionado ao banco.`, 'success');
  }

  function addToMix(player) {
    if (state.mix.some(item => item.nome.toLowerCase() === player.nome.toLowerCase())) {
      return notify(`${player.nome} ja esta no mix.`, 'error');
    }
    updateState({ mix: [...state.mix, { ...player, id: uid() }] });
    notify(`${player.nome} entrou no mix.`, 'success');
  }

  function addAllToMix() {
    const next = [...state.mix];
    state.banco.forEach(player => {
      if (!next.some(item => item.nome.toLowerCase() === player.nome.toLowerCase())) {
        next.push({ ...player, id: uid() });
      }
    });
    updateState({ mix: next });
    notify('Banco adicionado ao mix.', 'success');
  }

  function saveEditing() {
    const name = editing.nome.trim();
    if (!name) return notify('Nome nao pode ficar vazio.', 'error');
    const key = editing.source;
    updateState({
      [key]: state[key].map(player => player.id === editing.id ? { ...player, nome: name, elo: Number(editing.elo) } : player)
    });
    setEditing(null);
    notify('Jogador atualizado.', 'success');
  }

  function generateTeams() {
    if (state.mix.length < 2) return notify('Adicione pelo menos 2 jogadores ao mix.', 'error');
    const sorted = [...state.mix].sort((a, b) => Number(b.elo) - Number(a.elo));
    const a = [];
    const b = [];
    sorted.forEach(player => {
      if (eloTotal(a) <= eloTotal(b)) a.push(player);
      else b.push(player);
    });
    updateState({ times: { ...state.times, a, b } });
    setActiveTab('times');
    notify('Times gerados.', 'success');
  }

  function drawMap() {
    const available = state.mapas.filter(map => !state.vetados.includes(map));
    if (!available.length) return notify('Todos os mapas estao vetados.', 'error');
    updateState({ mapa: available[Math.floor(Math.random() * available.length)] });
  }

  function addMap(name) {
    const value = name.trim();
    if (!value) return;
    if (state.mapas.some(map => map.toLowerCase() === value.toLowerCase())) return notify('Mapa ja existe.', 'error');
    updateState({ mapas: [...state.mapas, value] });
  }

  function saveMatch(payload) {
    const match = {
      id: uid(),
      date: new Date().toISOString(),
      mixName: state.nomeMix || 'Mix sem nome',
      mapa: state.mapa || 'Nao sorteado',
      teams: state.times,
      ...payload
    };
    updateState({ historico: [match, ...state.historico] });
    setActiveTab('historico');
    notify('Partida salva no historico.', 'success');
  }

  if (!token) {
    return (
      <Shell>
        <AuthCard
          authMode={authMode}
          setAuthMode={setAuthMode}
          authForm={authForm}
          setAuthForm={setAuthForm}
          onSubmit={submitAuth}
        />
        <Toast toast={toast} />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="topbar">
        <Logo />
        <label className="mix-name">
          <span>Nome do mix</span>
          <input value={state.nomeMix || ''} onChange={event => updateState({ nomeMix: event.target.value })} placeholder="Ex: Mix de sabado" />
        </label>
        <div className="top-actions">
          <span className={`sync sync-${saving}`}>{saving === 'saving' ? 'Salvando' : saving === 'error' ? 'Erro ao salvar' : 'Salvo'}</span>
          <span className="user-chip">{user}</span>
          <span className="count-chip">{state.mix.length} jogadores</span>
          <button className="btn ghost" onClick={logout}>Sair</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>
        ))}
      </nav>

      {loading ? <Loading /> : (
        <main className="layout">
          {activeTab === 'banco' && (
            <BankTab
              players={state.banco}
              onAdd={addPlayerToBank}
              onAddMix={addToMix}
              onAddAll={addAllToMix}
              onEdit={player => setEditing({ source: 'banco', ...player })}
              onRemove={id => updateState({ banco: state.banco.filter(player => player.id !== id) })}
            />
          )}
          {activeTab === 'mix' && (
            <MixTab
              players={state.mix}
              stats={mixStats}
              onAdd={player => addToMix({ ...player, id: uid() })}
              onEdit={player => setEditing({ source: 'mix', ...player })}
              onRemove={id => updateState({ mix: state.mix.filter(player => player.id !== id) })}
              onReset={() => updateState({ mix: [], times: { ...state.times, a: [], b: [] } })}
            />
          )}
          {activeTab === 'times' && (
            <TeamsTab
              state={state}
              updateState={updateState}
              generateTeams={generateTeams}
              drawMap={drawMap}
              addMap={addMap}
            />
          )}
          {activeTab === 'resultado' && <ResultTab state={state} onSave={saveMatch} />}
          {activeTab === 'historico' && (
            <HistoryTab
              matches={state.historico}
              onDelete={id => updateState({ historico: state.historico.filter(match => match.id !== id) })}
              onClear={() => updateState({ historico: [] })}
            />
          )}
        </main>
      )}

      {editing && (
        <EditModal
          editing={editing}
          setEditing={setEditing}
          onSave={saveEditing}
        />
      )}
      <Toast toast={toast} />
    </Shell>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Shell>
          <main className="auth-screen">
            <section className="auth-card card">
              <Logo />
              <h1>Erro ao abrir o MIXVAL</h1>
              <p>{this.state.error.message || 'Atualize a pagina ou limpe a sessao do navegador.'}</p>
              <button className="btn primary wide" onClick={() => {
                localStorage.removeItem('mixval_auth_session');
                localStorage.removeItem('mixval_auth_token');
                window.location.reload();
              }}>
                Recarregar app
              </button>
            </section>
          </main>
        </Shell>
      );
    }
    return this.props.children;
  }
}

function Shell({ children }) {
  return (
    <div className="app-shell">
      <div className="scanlines" />
      <div className="ambient" />
      {children}
    </div>
  );
}

function Logo() {
  return <div className="logo"><span>MIX</span><strong>VAL</strong></div>;
}

function AuthCard({ authMode, setAuthMode, authForm, setAuthForm, onSubmit }) {
  const isLogin = authMode === 'login';
  return (
    <main className="auth-screen">
      <section className="auth-card card">
        <Logo />
        <p>Organize banco, mix, times e historico com dados salvos no MongoDB Atlas.</p>
        <form onSubmit={onSubmit} className="form-grid">
          <label>
            <span>{isLogin ? 'Usuario' : 'Novo usuario'}</span>
            <input value={authForm.userName} onChange={event => setAuthForm({ ...authForm, userName: event.target.value })} autoComplete="username" />
          </label>
          <label>
            <span>Senha</span>
            <input type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} autoComplete={isLogin ? 'current-password' : 'new-password'} />
          </label>
          <button className="btn primary wide" type="submit">{isLogin ? 'Entrar' : 'Criar conta'}</button>
        </form>
        <button className="link-btn" onClick={() => setAuthMode(isLogin ? 'register' : 'login')}>
          {isLogin ? 'Criar nova conta' : 'Ja tenho conta'}
        </button>
      </section>
    </main>
  );
}

function PlayerForm({ onSubmit, title = 'Adicionar jogador' }) {
  const [nome, setNome] = useState('');
  const [elo, setElo] = useState(3);
  return (
    <form className="card form-card" onSubmit={event => {
      event.preventDefault();
      onSubmit({ nome, elo });
      setNome('');
      setElo(3);
    }}>
      <h3>{title}</h3>
      <div className="inline-form">
        <label><span>Nome</span><input value={nome} onChange={event => setNome(event.target.value)} maxLength={30} /></label>
        <label><span>Elo</span><select value={elo} onChange={event => setElo(Number(event.target.value))}>{Object.entries(ELOS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <button className="btn primary" type="submit">Adicionar</button>
      </div>
    </form>
  );
}

function BankTab(props) {
  return (
    <section>
      <PanelHeader title="Banco de jogadores" subtitle="Gerencie o elenco fixo e envie nomes para o mix atual." />
      <PlayerForm onSubmit={props.onAdd} />
      <div className="section-actions">
        <button className="btn secondary" onClick={props.onAddAll}>Adicionar todos ao mix</button>
        <span>{props.players.length} no banco</span>
      </div>
      <PlayerGrid players={props.players} empty="Nenhum jogador no banco." actions={player => (
        <>
          <button onClick={() => props.onAddMix(player)}>+ Mix</button>
          <button onClick={() => props.onEdit(player)}>Editar</button>
          <button className="danger-text" onClick={() => props.onRemove(player.id)}>Remover</button>
        </>
      )} />
    </section>
  );
}

function MixTab({ players, stats, onAdd, onEdit, onRemove, onReset }) {
  return (
    <section>
      <PanelHeader title="Mix atual" subtitle="Controle quem vai jogar esta rodada." />
      <div className="mix-toolbar">
        <PlayerForm title="Adicionar manualmente" onSubmit={onAdd} />
        <button className="btn danger" onClick={onReset}>Resetar lista</button>
      </div>
      <div className="stat-row">
        <Stat label="Jogadores" value={stats.count} />
        <Stat label="Elo medio" value={stats.average} />
        <Stat label="Elo total" value={stats.total || '-'} />
      </div>
      <PlayerGrid players={players} empty="Nenhum jogador no mix." actions={player => (
        <>
          <button onClick={() => onEdit(player)}>Editar</button>
          <button className="danger-text" onClick={() => onRemove(player.id)}>Remover</button>
        </>
      )} />
    </section>
  );
}

function TeamsTab({ state, updateState, generateTeams, drawMap, addMap }) {
  const [mapName, setMapName] = useState('');
  const diff = Math.abs(eloTotal(state.times.a) - eloTotal(state.times.b));
  return (
    <section>
      <PanelHeader title="Times" subtitle="Balanceie equipes, sorteie mapa e controle vetos." />
      <div className="control-grid">
        <div className="card map-card">
          <span>Mapa sorteado</span>
          <strong>{state.mapa || '-'}</strong>
          <button className="btn secondary" onClick={drawMap}>Sortear mapa</button>
        </div>
        <div className="card team-actions">
          <button className="btn primary" onClick={generateTeams}>Gerar times</button>
          <button className="btn secondary" onClick={generateTeams}>Refazer balanceamento</button>
        </div>
      </div>
      <div className="teams-grid">
        <TeamCard label="A" team={state.times.a} name={state.times.nomeA} onName={value => updateState({ times: { ...state.times, nomeA: value } })} />
        <div className="vs-card">
          <strong>VS</strong>
          <span>Diferenca de elo</span>
          <b>{diff}</b>
          <small>{diff <= 1 ? 'Equilibrado' : diff <= 3 ? 'Leve desbalanceio' : 'Desbalanceado'}</small>
        </div>
        <TeamCard label="B" team={state.times.b} name={state.times.nomeB} onName={value => updateState({ times: { ...state.times, nomeB: value } })} />
      </div>
      <div className="card maps-panel">
        <div className="maps-head">
          <div>
            <h3>Mapas</h3>
            <p>Clique em um mapa para vetar ou liberar no sorteio.</p>
          </div>
          <div className="maps-counts">
            <span>{state.mapas.length - state.vetados.length} disponiveis</span>
            <span>{state.vetados.length} vetados</span>
          </div>
        </div>
        <form className="map-add-form" onSubmit={event => { event.preventDefault(); addMap(mapName); setMapName(''); }}>
          <input value={mapName} onChange={event => setMapName(event.target.value)} placeholder="Adicionar novo mapa" />
          <button className="btn secondary" type="submit">Adicionar</button>
        </form>
        <div className="map-list">
          {state.mapas.map(map => (
            <label key={map} className={state.vetados.includes(map) ? 'map-item vetoed' : 'map-item'} title={state.vetados.includes(map) ? 'Clique para liberar este mapa' : 'Clique para vetar este mapa'}>
              <input
                type="checkbox"
                checked={state.vetados.includes(map)}
                onChange={event => {
                  const vetados = event.target.checked
                    ? [...state.vetados, map]
                    : state.vetados.filter(item => item !== map);
                  updateState({ vetados });
                }}
              />
              <span className="map-name">{map}</span>
              <span className="map-status">{state.vetados.includes(map) ? 'Vetado' : 'Disponivel'}</span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResultTab({ state, onSave }) {
  const [score, setScore] = useState({ a: 13, b: 5, winner: 'A' });
  const [stats, setStats] = useState({});
  const hasTeams = state.times.a.length || state.times.b.length;

  useEffect(() => {
    const next = {};
    [...state.times.a, ...state.times.b].forEach(player => {
      next[player.id] = stats[player.id] || { kills: 0, deaths: 0, assists: 0, firstBlood: 0 };
    });
    setStats(next);
  }, [state.times.a, state.times.b]);

  if (!hasTeams) {
    return (
      <section>
        <PanelHeader title="Pos-partida" subtitle="Registre o resultado depois de gerar os times." />
        <Empty text="Gere os times antes de registrar uma partida." />
      </section>
    );
  }

  const save = () => {
    const playerStats = Object.fromEntries(Object.entries(stats).map(([id, item]) => [id, { ...item, kda: calcKda(item.kills, item.deaths, item.assists) }]));
    onSave({ score, playerStats });
  };

  return (
    <section>
      <PanelHeader title="Pos-partida" subtitle="Salve placar e estatisticas da rodada." />
      <div className="card result-card">
        <div className="score-row">
          <label><span>{state.times.nomeA}</span><input type="number" value={score.a} onChange={event => setScore({ ...score, a: Number(event.target.value) })} /></label>
          <strong>x</strong>
          <label><span>{state.times.nomeB}</span><input type="number" value={score.b} onChange={event => setScore({ ...score, b: Number(event.target.value) })} /></label>
          <select value={score.winner} onChange={event => setScore({ ...score, winner: event.target.value })}>
            <option value="A">Vitoria A</option>
            <option value="B">Vitoria B</option>
            <option value="draw">Empate</option>
          </select>
        </div>
        <div className="stats-grid">
          <StatsTable name={state.times.nomeA} team={state.times.a} stats={stats} setStats={setStats} />
          <StatsTable name={state.times.nomeB} team={state.times.b} stats={stats} setStats={setStats} />
        </div>
        <button className="btn primary wide" onClick={save}>Salvar partida</button>
      </div>
    </section>
  );
}

function HistoryTab({ matches, onDelete, onClear }) {
  const [openMatchId, setOpenMatchId] = useState(null);

  return (
    <section>
      <PanelHeader title="Historico" subtitle="Partidas registradas no banco da sua conta." />
      <div className="section-actions"><button className="btn danger" onClick={onClear}>Limpar historico</button></div>
      {!matches.length ? <Empty text="Nenhuma partida registrada." /> : (
        <div className="history-list">
          {matches.map(match => (
            <article className="card history-card" key={match.id}>
              <div className="history-summary">
                <div>
                  <strong>{match.mixName}</strong>
                  <span>{formatDate(match.date)} - {match.mapa}</span>
                </div>
                <div className="history-score">{match.teams.nomeA} {match.score.a} x {match.score.b} {match.teams.nomeB}</div>
                <WinnerBadge match={match} />
                <div className="history-actions">
                  <button className="btn secondary" onClick={() => setOpenMatchId(openMatchId === match.id ? null : match.id)}>
                    {openMatchId === match.id ? 'Ocultar detalhes' : 'Ver detalhes'}
                  </button>
                  <button className="danger-text" onClick={() => onDelete(match.id)}>Excluir</button>
                </div>
              </div>
              {openMatchId === match.id && <MatchDetails match={match} />}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function WinnerBadge({ match }) {
  const label = match.score.winner === 'A'
    ? `Vitoria ${match.teams.nomeA}`
    : match.score.winner === 'B'
      ? `Vitoria ${match.teams.nomeB}`
      : 'Empate';
  return <span className={match.score.winner === 'draw' ? 'winner-badge draw' : 'winner-badge'}>{label}</span>;
}

function MatchDetails({ match }) {
  return (
    <div className="match-details">
      <HistoryTeamTable
        title={match.teams.nomeA}
        team={match.teams.a || []}
        playerStats={match.playerStats || {}}
      />
      <HistoryTeamTable
        title={match.teams.nomeB}
        team={match.teams.b || []}
        playerStats={match.playerStats || {}}
      />
    </div>
  );
}

function HistoryTeamTable({ title, team, playerStats }) {
  const totalKills = team.reduce((sum, player) => sum + Number(playerStats[player.id]?.kills || 0), 0);
  const totalFb = team.reduce((sum, player) => sum + Number(playerStats[player.id]?.firstBlood || 0), 0);

  return (
    <div className="history-team">
      <div className="history-team-head">
        <h3>{title}</h3>
        <span>{team.length} jogadores</span>
        <span>{totalKills} kills</span>
        <span>{totalFb} FB</span>
      </div>
      <div className="history-table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>Jogador</th>
              <th>Elo</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              <th>KDA</th>
              <th>FB</th>
            </tr>
          </thead>
          <tbody>
            {team.map(player => {
              const stats = playerStats[player.id] || {};
              return (
                <tr key={player.id}>
                  <td>{player.nome}</td>
                  <td><EloBadge elo={player.elo} /></td>
                  <td>{stats.kills ?? 0}</td>
                  <td>{stats.deaths ?? 0}</td>
                  <td>{stats.assists ?? 0}</td>
                  <td>{stats.kda ?? calcKda(stats.kills, stats.deaths, stats.assists)}</td>
                  <td>{stats.firstBlood ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatsTable({ name, team, stats, setStats }) {
  const update = (id, field, value) => setStats(current => ({
    ...current,
    [id]: { ...(current[id] || {}), [field]: Number(value) }
  }));
  return (
    <div className="stats-table-wrap">
      <h3>{name}</h3>
      <table>
        <thead><tr><th>Jogador</th><th>K</th><th>D</th><th>A</th><th>FB</th></tr></thead>
        <tbody>
          {team.map(player => (
            <tr key={player.id}>
              <td>{player.nome}</td>
              {['kills', 'deaths', 'assists', 'firstBlood'].map(field => (
                <td key={field}><input type="number" min="0" value={stats[player.id]?.[field] || 0} onChange={event => update(player.id, field, event.target.value)} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamCard({ label, name, team, onName }) {
  return (
    <article className="card team-card">
      <div className="team-head">
        <input value={name} onChange={event => onName(event.target.value)} />
        <span>Time {label}</span>
      </div>
      <div className="team-total">Elo {eloTotal(team)}</div>
      {team.length ? team.map(player => <PlayerLine key={player.id} player={player} />) : <Empty text="Time vazio." compact />}
    </article>
  );
}

function PlayerGrid({ players, actions, empty }) {
  if (!players.length) return <Empty text={empty} />;
  return <div className="player-grid">{players.map(player => <PlayerCard key={player.id} player={player} actions={actions(player)} />)}</div>;
}

function PlayerCard({ player, actions }) {
  return (
    <article className="player-card">
      <div className="avatar">{initials(player.nome)}</div>
      <div>
        <strong>{player.nome}</strong>
        <EloBadge elo={player.elo} />
      </div>
      <div className="player-actions">{actions}</div>
    </article>
  );
}

function PlayerLine({ player }) {
  return <div className="player-line"><span>{player.nome}</span><EloBadge elo={player.elo} /></div>;
}

function EloBadge({ elo }) {
  return <span className={`elo elo-${elo}`}>{ELOS[elo] || '?'}</span>;
}

function PanelHeader({ title, subtitle }) {
  return <div className="panel-header"><h1>{title}</h1><p>{subtitle}</p></div>;
}

function Stat({ label, value }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}

function Empty({ text, compact = false }) {
  return <div className={compact ? 'empty compact' : 'empty'}>{text}</div>;
}

function Loading() {
  return <main className="layout"><Empty text="Carregando dados..." /></main>;
}

function EditModal({ editing, setEditing, onSave }) {
  return (
    <div className="modal-backdrop">
      <section className="modal card">
        <h3>Editar jogador</h3>
        <label><span>Nome</span><input value={editing.nome} onChange={event => setEditing({ ...editing, nome: event.target.value })} /></label>
        <label><span>Elo</span><select value={editing.elo} onChange={event => setEditing({ ...editing, elo: Number(event.target.value) })}>{Object.entries(ELOS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <div className="modal-actions">
          <button className="btn primary" onClick={onSave}>Salvar</button>
          <button className="btn secondary" onClick={() => setEditing(null)}>Cancelar</button>
        </div>
      </section>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast ${toast.type}`}>{toast.message}</div>;
}

export default function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
