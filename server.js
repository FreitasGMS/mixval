'use strict';

require('dotenv').config();

const crypto = require('crypto');
const dns = require('dns');
const express = require('express');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 8099);
const clientDist = path.join(__dirname, 'dist');
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'mixval';
const sessionSecret = process.env.SESSION_SECRET || 'dev-session-secret';
const isDev = process.env.NODE_ENV !== 'production';
const dnsServers = (process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8').split(',').map(s => s.trim()).filter(Boolean);

if (dnsServers.length) {
  dns.setServers(dnsServers);
}

if (!mongoUri) {
  console.warn('Aviso: defina MONGODB_URI no .env para conectar ao MongoDB Atlas.');
}

let db;

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

app.use(express.json({ limit: '1mb' }));
app.use(express.static(clientDist));
app.use(express.static(__dirname));

function normalizeUserName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function signToken(userName) {
  const payload = Buffer.from(JSON.stringify({
    user: userName,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.user || data.exp < Date.now()) return null;
    return data.user;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Sessao invalida.' });
  req.user = user;
  next();
}

function cleanState(input) {
  return {
    ...DEFAULT_STATE,
    ...(input || {}),
    editando: undefined
  };
}

function publicErrorDetail(err) {
  const message = err && err.message ? err.message : '';
  if (message.includes('authentication failed') || message.includes('bad auth')) {
    return 'MongoDB Atlas recusou usuario/senha. Confira o Database User e a senha no Atlas.';
  }
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEOUT') || message.includes('querySrv')) {
    return 'Nao foi possivel resolver/conectar ao endereco do MongoDB Atlas.';
  }
  return isDev ? message : undefined;
}

async function getDb() {
  if (db) return db;
  if (!mongoUri) throw new Error('MONGODB_URI nao configurada.');
  const client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  await db.collection('users').createIndex({ userName: 1 }, { unique: true });
  await db.collection('states').createIndex({ userName: 1 }, { unique: true });
  return db;
}

app.post('/api/register', async (req, res) => {
  try {
    const database = await getDb();
    const userName = normalizeUserName(req.body.userName);
    const password = String(req.body.password || '');
    if (!userName) return res.status(400).json({ error: 'Digite um usuario valido.' });
    if (password.length < 4) return res.status(400).json({ error: 'A senha precisa ter 4 caracteres ou mais.' });

    const { salt, hash } = hashPassword(password);
    await database.collection('users').insertOne({
      userName,
      salt,
      passwordHash: hash,
      createdAt: new Date()
    });
    await database.collection('states').insertOne({
      userName,
      state: DEFAULT_STATE,
      updatedAt: new Date()
    });

    res.status(201).json({ userName, token: signToken(userName), state: DEFAULT_STATE });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Este usuario ja existe.' });
    console.error('Erro ao criar conta:', err);
    res.status(500).json({ error: 'Erro ao criar conta.', detail: publicErrorDetail(err) });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const database = await getDb();
    const userName = normalizeUserName(req.body.userName);
    const password = String(req.body.password || '');
    const user = await database.collection('users').findOne({ userName });
    if (!user || !verifyPassword(password, user)) {
      return res.status(401).json({ error: 'Usuario ou senha incorretos.' });
    }

    const saved = await database.collection('states').findOne({ userName });
    res.json({ userName, token: signToken(userName), state: cleanState(saved && saved.state) });
  } catch (err) {
    console.error('Erro ao entrar:', err);
    res.status(500).json({ error: 'Erro ao entrar.', detail: publicErrorDetail(err) });
  }
});

app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const database = await getDb();
    const saved = await database.collection('states').findOne({ userName: req.user });
    res.json({ state: cleanState(saved && saved.state) });
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    res.status(500).json({ error: 'Erro ao carregar dados.', detail: publicErrorDetail(err) });
  }
});

app.put('/api/state', requireAuth, async (req, res) => {
  try {
    const database = await getDb();
    const nextState = cleanState(req.body.state);
    await database.collection('states').updateOne(
      { userName: req.user },
      { $set: { state: nextState, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar dados:', err);
    res.status(500).json({ error: 'Erro ao salvar dados.', detail: publicErrorDetail(err) });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), err => {
    if (err) res.sendFile(path.join(__dirname, 'index.html'));
  });
});

app.listen(port, () => {
  console.log(`MIXVAL rodando em http://127.0.0.1:${port}`);
});
