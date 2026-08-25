// Double-entry ledger. Integer base units, debit positive, credit negative,
// every transaction sums to zero per currency. Nothing is updated or deleted.
import { db, now } from './db.js';

const insTxn = db.prepare('INSERT INTO txn (ts, kind, ref, memo) VALUES (?, ?, ?, ?)');
const insEntry = db.prepare('INSERT INTO entry (txn_id, account, currency, amount) VALUES (?, ?, ?, ?)');
const balStmt = db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM entry WHERE account = ? AND currency = ?');
const refStmt = db.prepare('SELECT 1 FROM txn WHERE ref = ? LIMIT 1');
const imbStmt = db.prepare('SELECT currency, COALESCE(SUM(amount), 0) AS b FROM entry GROUP BY currency');
const byAccountStmt = db.prepare('SELECT account, currency, COALESCE(SUM(amount), 0) AS b FROM entry GROUP BY account, currency');
const spentStmt = db.prepare(`
  SELECT COALESCE(-SUM(e.amount), 0) AS spent FROM entry e JOIN txn t ON t.id = e.txn_id
  WHERE t.kind = ? AND t.ts >= ? AND e.account = 'Cash' AND e.currency = ? AND e.amount < 0`);
const listStmt = db.prepare(`
  SELECT t.id, t.ts, t.kind, t.ref, t.memo,
    json_group_array(json_object('account', e.account, 'currency', e.currency, 'amount', e.amount)) AS entries
  FROM txn t JOIN entry e ON e.txn_id = t.id GROUP BY t.id ORDER BY t.id DESC LIMIT ?`);

const post = db.transaction((kind, entries, ref, memo) => {
  const info = insTxn.run(now(), kind, ref, memo);
  for (const [account, currency, amount] of entries) insEntry.run(info.lastInsertRowid, account, currency, amount);
  return Number(info.lastInsertRowid);
});

export function book(kind, entries, { ref = '', memo = '' } = {}) {
  if (!entries.length) throw new Error(`ledger: '${kind}' has no entries`);
  const sums = {};
  for (const [account, currency, amount] of entries) {
    if (!Number.isInteger(amount)) throw new Error(`ledger: ${account} ${currency} amount ${amount} is not an integer`);
    if (currency !== 'USDC' && currency !== 'SOL') throw new Error(`ledger: unknown currency ${currency}`);
    sums[currency] = (sums[currency] || 0) + amount;
  }
  for (const [c, s] of Object.entries(sums)) {
    if (s !== 0) throw new Error(`ledger: '${kind}' is unbalanced in ${c}: entries sum to ${s}, must be 0`);
  }
  try {
    return post(kind, entries, ref, memo);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new Error(`ledger: ref '${ref}' already booked; refusing to double-book`);
    throw e;
  }
}

export const balance = (account, currency = 'USDC') => balStmt.get(account, currency).b;
export const hasRef = (ref) => Boolean(ref) && refStmt.get(ref) !== undefined;
export const imbalance = () => Object.fromEntries(imbStmt.all().map((r) => [r.currency, r.b]));
export const spentSince = (kind, sinceIso, currency = 'USDC') => spentStmt.get(kind, sinceIso, currency).spent;
export const transactions = (limit = 50) => listStmt.all(limit).map((r) => ({ ...r, entries: JSON.parse(r.entries) }));

export const trialBalance = () => byAccountStmt.all().map((r) => ({ account: r.account, currency: r.currency, balance: r.b }));

export function pnl() {
  const rows = byAccountStmt.all();
  const get = (account, currency = 'USDC') => rows.find((r) => r.account === account && r.currency === currency)?.b ?? 0;
  const revenueSales = -get('Revenue:Sales');
  const revenueFeesSol = -get('Revenue:Fees', 'SOL');
  const cogs = get('COGS');
  const expenses = {
    platformFee: get('Expense:PlatformFee'),
    compute: get('Expense:Compute'),
    hosting: get('Expense:Hosting'),
    gas: get('Expense:Gas', 'SOL'),
  };
  const fxUsdc = -get('FX');
  const net = revenueSales + fxUsdc - cogs - expenses.platformFee - expenses.compute - expenses.hosting;
  return {
    cashU: get('Cash'),
    cashLamports: get('Cash', 'SOL'),
    inventoryU: get('Inventory'),
    revenueSalesU: revenueSales,
    feesReceivedLamports: revenueFeesSol,
    swappedToUsdcU: fxUsdc,
    cogsU: cogs,
    expenses,
    netU: net,
    driftU: -get('Equity:Drift'),
    operatorCapitalU: -get('Equity'),
    operatorCapitalLamports: -get('Equity', 'SOL'),
  };
}
