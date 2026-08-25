// One path for every on-chain action: sign, persist the signature, send,
// confirm, then book. Paper mode stops after the gate and records the intent.
import { cfg } from './config.js';
import { db, now } from './db.js';
import { signTx, sendRaw, confirm } from './wallet.js';
import { log } from './log.js';

const getStmt = db.prepare('SELECT * FROM actions WHERE key = ?');
const insStmt = db.prepare(`INSERT INTO actions (key, kind, nft_address, amount_u, state, gate, reason, sig, error, created_at, updated_at)
  VALUES (@key, @kind, @nft_address, @amount_u, @state, @gate, @reason, @sig, @error, @created_at, @updated_at)
  ON CONFLICT(key) DO UPDATE SET state=excluded.state, gate=excluded.gate, reason=excluded.reason, sig=COALESCE(excluded.sig, sig),
  error=excluded.error, updated_at=excluded.updated_at`);
const updStmt = db.prepare('UPDATE actions SET state = ?, error = ?, updated_at = ? WHERE key = ?');

export const getAction = (key) => getStmt.get(key);
export const recentActions = (limit = 50) => db.prepare('SELECT * FROM actions ORDER BY id DESC LIMIT ?').all(limit);
export const actionsInState = (...states) => db.prepare(`SELECT * FROM actions WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY id`).all(...states);
export const setActionState = (key, state, error = null) => updStmt.run(state, error, now(), key);

export function recordDenied({ key, kind, nftAddress = null, amountU = null, gate, reason }) {
  const t = now();
  insStmt.run({ key, kind, nft_address: nftAddress, amount_u: amountU, state: 'denied', gate, reason, sig: null, error: null, created_at: t, updated_at: t });
}

// build() returns an unsigned base64 tx, or {sig, signedBase64} if it signed itself.
// send(signedBase64) submits it (CC broadcast or raw RPC). onConfirmed(row) books.
export async function perform({ key, kind, nftAddress = null, amountU = null, build, send = sendRaw, onConfirmed }) {
  const existing = getAction(key);
  if (existing && ['signed', 'sent', 'confirmed'].includes(existing.state)) {
    log('act', 'warn', `${kind} ${key} already ${existing.state}; reconcile owns it`);
    return existing;
  }
  const t = now();
  const base = { key, kind, nft_address: nftAddress, amount_u: amountU, gate: 'ok', reason: null, error: null, created_at: t, updated_at: t };
  if (cfg.paper) {
    insStmt.run({ ...base, state: 'confirmed', reason: 'paper', sig: null });
    const row = getAction(key);
    await onConfirmed?.(row);
    return row;
  }
  const built = await build();
  const { sig, signedBase64 } = typeof built === 'string' ? signTx(built) : built;
  insStmt.run({ ...base, state: 'signed', sig });
  try {
    await send(signedBase64);
  } catch (e) {
    setActionState(key, 'failed', `send: ${e.message}`);
    throw e;
  }
  setActionState(key, 'sent');
  const status = await confirm(sig);
  if (status !== 'ok') {
    setActionState(key, 'failed', `confirm: ${status}`);
    throw new Error(`${kind} ${key} ${status} (${sig})`);
  }
  setActionState(key, 'confirmed');
  log('act', 'info', `${kind} confirmed`, { key, sig });
  const row = getAction(key);
  await onConfirmed?.(row);
  return row;
}
