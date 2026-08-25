import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cfg } from './config.js';

if (cfg.dbPath !== ':memory:') mkdirSync(dirname(cfg.dbPath), { recursive: true });
export const db = new Database(cfg.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS txn (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS txn_ref ON txn(ref) WHERE ref != '';
CREATE TABLE IF NOT EXISTS entry (
  id INTEGER PRIMARY KEY,
  txn_id INTEGER NOT NULL REFERENCES txn(id),
  account TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USDC','SOL')),
  amount INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entry_account ON entry(account, currency);
CREATE INDEX IF NOT EXISTS entry_txn ON entry(txn_id);

CREATE TABLE IF NOT EXISTS listings_seen (
  nft_address TEXT PRIMARY KEY,
  item_name TEXT,
  card_key TEXT,
  identity_json TEXT,
  price_u INTEGER,
  owner TEXT,
  listed_at TEXT,
  seen_at TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  score_json TEXT,
  skip_reason TEXT,
  insured_u INTEGER,
  grade_num REAL,
  grading_company TEXT,
  nft_standard TEXT
);
CREATE INDEX IF NOT EXISTS listings_status ON listings_seen(status);

CREATE TABLE IF NOT EXISTS comps (
  card_key TEXT PRIMARY KEY,
  price_u INTEGER,
  n INTEGER,
  latest_at TEXT,
  spread_pct REAL,
  confidence TEXT,
  source TEXT,
  raw_json TEXT,
  fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY,
  nft_address TEXT UNIQUE NOT NULL,
  card_key TEXT,
  identity_json TEXT,
  cost_u INTEGER NOT NULL,
  buy_action_id INTEGER,
  bought_at TEXT,
  state TEXT NOT NULL DEFAULT 'held',
  list_price_u INTEGER,
  listed_at TEXT,
  last_reprice_at TEXT,
  comp_at_buy_u INTEGER,
  sold_u INTEGER,
  sold_at TEXT,
  sale_sig TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  nft_address TEXT,
  amount_u INTEGER,
  state TEXT NOT NULL,
  gate TEXT,
  reason TEXT,
  sig TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS actions_state ON actions(state);

CREATE TABLE IF NOT EXISTS processed_tx (
  sig TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  lamports INTEGER DEFAULT 0,
  usdc_u INTEGER DEFAULT 0,
  nft_mints TEXT,
  from_addr TEXT,
  seen_at TEXT NOT NULL,
  booked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY,
  quote_id TEXT UNIQUE,
  purpose TEXT NOT NULL,
  model TEXT,
  quoted_u INTEGER,
  paid_u INTEGER,
  pay_sig TEXT,
  in_tokens INTEGER,
  out_tokens INTEGER,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  context_json TEXT,
  llm_call_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  name TEXT PRIMARY KEY,
  last_at TEXT,
  last_ok INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

export const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);

const kvGetStmt = db.prepare('SELECT value FROM kv WHERE key = ?');
const kvSetStmt = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
export const kvGet = (k) => kvGetStmt.get(k)?.value ?? null;
export const kvSet = (k, v) => kvSetStmt.run(k, String(v));

const counterIncStmt = db.prepare('INSERT INTO counters (day, name, n) VALUES (?, ?, ?) ON CONFLICT(day, name) DO UPDATE SET n = n + excluded.n');
const counterGetStmt = db.prepare('SELECT n FROM counters WHERE day = ? AND name = ?');
export const counterInc = (name, by = 1) => counterIncStmt.run(today(), name, by);
export const counterGet = (name) => counterGetStmt.get(today(), name)?.n ?? 0;

const runStmt = db.prepare('INSERT INTO runs (name, last_at, last_ok, note) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET last_at = excluded.last_at, last_ok = excluded.last_ok, note = excluded.note');
export const runMark = (name, ok, note = '') => runStmt.run(name, now(), ok ? 1 : 0, note);
export const runs = () => db.prepare('SELECT * FROM runs ORDER BY name').all();
