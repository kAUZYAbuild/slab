// Money arriving at the wallet, and turning fee SOL into USDC. Classification
// is by transaction shape, not by schedule. Anything we cannot attribute is
// booked as operator capital and flagged, never dropped.
import { cfg } from './config.js';
import { db, now, kvGet } from './db.js';
import { book, hasRef } from './ledger.js';
import { getSignatures, getTx, pubkey, getSOLBalance, buildUSDCTransfer, USDC_MINT } from './wallet.js';
import { authorize } from './gate.js';
import { perform } from './act.js';
import { log } from './log.js';

const seen = db.prepare('SELECT 1 FROM processed_tx WHERE sig = ?');
const record = db.prepare(`INSERT OR IGNORE INTO processed_tx (sig, kind, lamports, usdc_u, nft_mints, from_addr, seen_at, booked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const payoutSources = () => new Set((process.env.PAYOUT_SOURCES ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const usepodPayTo = () => new Set((kvGet('usepod_payto') ?? '').split(',').filter(Boolean));

export function classify(tx, me) {
  const keys = tx.transaction.message.accountKeys.map((k) => (k.pubkey ?? k).toString());
  const i = keys.indexOf(me);
  const lamports = i >= 0 ? tx.meta.postBalances[i] - tx.meta.preBalances[i] : 0;
  const tokenDelta = (balances) => balances.filter((b) => b.owner === me && b.mint === USDC_MINT.toBase58()).reduce((s, b) => s + Number(b.uiTokenAmount.amount), 0);
  const usdcU = tokenDelta(tx.meta.postTokenBalances ?? []) - tokenDelta(tx.meta.preTokenBalances ?? []);
  const nftOut = [];
  const nftIn = [];
  for (const b of tx.meta.preTokenBalances ?? []) {
    if (b.owner !== me || b.uiTokenAmount.decimals !== 0) continue;
    const post = (tx.meta.postTokenBalances ?? []).find((p) => p.accountIndex === b.accountIndex);
    if (b.uiTokenAmount.amount === '1' && (!post || post.uiTokenAmount.amount === '0')) nftOut.push(b.mint);
  }
  for (const b of tx.meta.postTokenBalances ?? []) {
    if (b.owner !== me || b.uiTokenAmount.decimals !== 0 || b.uiTokenAmount.amount !== '1') continue;
    const pre = (tx.meta.preTokenBalances ?? []).find((p) => p.accountIndex === b.accountIndex);
    if (!pre || pre.uiTokenAmount.amount === '0') nftIn.push(b.mint);
  }
  const feePayer = keys[0];
  const self = feePayer === me;
  let kind = 'unknown';
  if (tx.meta.err) kind = 'failed';
  else if (self) kind = 'self';
  else if (usdcU > 0 && nftOut.length) kind = 'sale';
  else if (usdcU > 0 && usepodPayTo().has(feePayer)) kind = 'refund';
  else if (usdcU > 0) kind = 'usdc_in';
  else if (usdcU < 0) kind = 'usdc_out';
  else if (lamports > 0 && payoutSources().has(feePayer)) kind = 'payout';
  else if (lamports > 0) kind = 'sol_in';
  return { kind, lamports, usdcU, nftOut, nftIn, from: feePayer, self };
}

function bookIncoming(sig, c) {
  const memo = `from ${c.from.slice(0, 6)}`;
  switch (c.kind) {
    case 'payout':
      book('payout', [['Cash', 'SOL', c.lamports], ['Revenue:Fees', 'SOL', -c.lamports]], { ref: `payout:${sig}`, memo });
      log('fees', 'info', `fee payout ${c.lamports} lamports`, { sig });
      return true;
    case 'sol_in':
      book('capital', [['Cash', 'SOL', c.lamports], ['Equity', 'SOL', -c.lamports]], { ref: `capital:${sig}`, memo });
      log('fees', 'warn', `SOL from ${c.from} booked as operator capital; add it to PAYOUT_SOURCES if it is the fee distributor`, { sig, lamports: c.lamports });
      return true;
    case 'refund':
      book('refund', [['Cash', 'USDC', c.usdcU], ['Expense:Compute', 'USDC', -c.usdcU]], { ref: `refund:${sig}`, memo });
      return true;
    case 'usdc_in':
      book('capital', [['Cash', 'USDC', c.usdcU], ['Equity', 'USDC', -c.usdcU]], { ref: `capital:${sig}`, memo });
      log('fees', 'warn', `USDC from ${c.from} booked as operator capital`, { sig, usdcU: c.usdcU });
      return true;
    case 'self': {
      // gas on our own txs; swaps book their full SOL delta themselves
      if (c.lamports < 0 && !hasRef(`swap:${sig}`)) {
        book('gas', [['Expense:Gas', 'SOL', -c.lamports], ['Cash', 'SOL', c.lamports]], { ref: `gas:${sig}` });
      }
      return true;
    }
    default:
      return c.kind === 'failed';
  }
}

export async function watchIncoming() {
  const me = pubkey();
  const sigs = await getSignatures(me, { limit: 25 });
  for (const s of sigs.reverse()) {
    if (seen.get(s.signature)) continue;
    const tx = await getTx(s.signature);
    if (!tx) continue;
    const c = classify(tx, me);
    const booked = bookIncoming(s.signature, c);
    record.run(s.signature, c.kind, c.lamports, c.usdcU, JSON.stringify({ out: c.nftOut, in: c.nftIn }), c.from, now(), booked ? 1 : 0);
  }
}

export const salesSeen = () => db.prepare("SELECT sig, usdc_u, nft_mints FROM processed_tx WHERE kind = 'sale'").all();

const SOL_MINT = 'So11111111111111111111111111111111111111112';
export async function swapExcessSol() {
  const sol = await getSOLBalance();
  const excess = sol - cfg.solReserveLamports;
  if (excess < 20_000_000) return;
  const key = `swap:${now().slice(0, 16)}`;
  const g = authorize({ kind: 'swap', amountU: excess, ref: key, host: 'lite-api.jup.ag' });
  if (!g.allowed) return;
  const me = pubkey();
  await perform({
    key, kind: 'swap', amountU: excess,
    build: async () => {
      const q = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT.toBase58()}&amount=${excess}&slippageBps=50`).then((r) => r.json());
      if (!q?.outAmount) throw new Error(`jupiter quote: ${JSON.stringify(q).slice(0, 200)}`);
      const s = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteResponse: q, userPublicKey: me, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }),
      }).then((r) => r.json());
      if (!s?.swapTransaction) throw new Error(`jupiter swap: ${JSON.stringify(s).slice(0, 200)}`);
      return s.swapTransaction;
    },
    onConfirmed: async (row) => {
      const tx = await getTx(row.sig);
      const c = classify(tx, me);
      const solOut = -c.lamports;
      book('swap', [['Cash', 'SOL', -solOut], ['FX', 'SOL', solOut], ['Cash', 'USDC', c.usdcU], ['FX', 'USDC', -c.usdcU]], { ref: `swap:${row.sig}`, memo: `${solOut} lamports -> ${c.usdcU} usdc` });
      record.run(row.sig, 'self', c.lamports, c.usdcU, null, me, now(), 1);
      log('fees', 'info', `swapped ${solOut} lamports for ${c.usdcU} usdc`, { sig: row.sig });
    },
  });
}

// Monthly hosting paid back to the operator, once, on the first tick of the month.
export async function opsReimburse() {
  const month = now().slice(0, 7);
  const ref = `hosting:${month}`;
  if (hasRef(ref) || !cfg.opsWallet) return;
  const g = authorize({ kind: 'hosting', amountU: cfg.hostingU, ref, host: 'solana' });
  if (!g.allowed) {
    log('ops', 'warn', `could not pay hosting for ${month}: ${g.reason}`);
    return;
  }
  await perform({
    key: ref, kind: 'transfer', amountU: cfg.hostingU,
    build: () => buildUSDCTransfer(cfg.opsWallet, cfg.hostingU, ref),
    onConfirmed: (row) => {
      book('hosting', [['Expense:Hosting', 'USDC', cfg.hostingU], ['Cash', 'USDC', -cfg.hostingU]], { ref, memo: `render ${month}` });
      if (row.sig) record.run(row.sig, 'self', 0, -cfg.hostingU, null, pubkey(), now(), 1);
      log('ops', 'info', `paid hosting for ${month}: ${cfg.hostingU}u`, { sig: row.sig });
    },
  });
}

export async function clawpumpEarnings() {
  if (!cfg.clawpumpAgentId) return null;
  const res = await fetch(`https://clawpump.tech/api/fees/earnings?agentId=${encodeURIComponent(cfg.clawpumpAgentId)}`, {
    headers: cfg.clawpumpKey ? { Authorization: `Bearer ${cfg.clawpumpKey}` } : {},
  });
  return res.ok ? res.json() : null;
}

