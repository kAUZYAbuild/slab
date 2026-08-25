// Chain state is the truth; the ledger and positions must agree with it.
// Runs on boot and every 30 minutes in live mode. Resolves actions that were
// signed or sent when the process died, books sales seen by the watcher,
// and flags balance drift (which blocks buys until an operator acknowledges).
import { cfg } from './config.js';
import { db, now, kvGet, kvSet } from './db.js';
import { book, hasRef, balance } from './ledger.js';
import { getTx, ownedNfts, getUSDCBalance, getSOLBalance, pubkey } from './wallet.js';
import { actionsInState, setActionState } from './act.js';
import { classify, salesSeen } from './fees.js';
import * as inventory from './inventory.js';
import { log } from './log.js';

const listingStmt = db.prepare('SELECT * FROM listings_seen WHERE nft_address = ?');
const positionStmt = db.prepare('SELECT * FROM positions WHERE nft_address = ?');
const listedStmt = db.prepare("UPDATE positions SET state = 'listed', list_price_u = ?, listed_at = COALESCE(listed_at, ?), last_reprice_at = ? WHERE nft_address = ?");
const stuckStmt = db.prepare("UPDATE positions SET state = 'stuck', note = ? WHERE nft_address = ?");
const boughtStmt = db.prepare("UPDATE listings_seen SET status = 'bought' WHERE nft_address = ?");

function bookBuy(action) {
  const listing = listingStmt.get(action.nft_address);
  if (!listing) {
    log('reconcile', 'error', `confirmed buy ${action.key} has no listing row; cannot book cost basis`);
    return;
  }
  if (!hasRef(action.key)) book('buy', [['Inventory', 'USDC', action.amount_u], ['Cash', 'USDC', -action.amount_u]], { ref: action.key, memo: listing.item_name });
  if (!positionStmt.get(action.nft_address)) {
    const s = listing.score_json ? JSON.parse(listing.score_json) : {};
    inventory.open({ nftAddress: action.nft_address, identity: JSON.parse(listing.identity_json), costU: action.amount_u, actionId: action.id, compU: s.compU ?? null, note: 'booked by reconcile' });
  }
  boughtStmt.run(action.nft_address);
}

async function resolveActions() {
  const me = pubkey();
  for (const a of actionsInState('signed', 'sent')) {
    const tx = await getTx(a.sig);
    if (!tx) {
      if (Date.now() - Date.parse(a.updated_at) > 3 * 60_000) setActionState(a.key, 'failed', 'not found on chain after 3 minutes (blockhash expired)');
      continue;
    }
    if (tx.meta.err) { setActionState(a.key, 'failed', `on-chain error ${JSON.stringify(tx.meta.err).slice(0, 120)}`); continue; }
    const c = classify(tx, me);
    switch (a.kind) {
      case 'buy': bookBuy(a); break;
      case 'list': case 'update': listedStmt.run(a.amount_u, now(), now(), a.nft_address); break;
      case 'transfer': if (a.key.startsWith('hosting:') && !hasRef(a.key)) book('hosting', [['Expense:Hosting', 'USDC', a.amount_u], ['Cash', 'USDC', -a.amount_u]], { ref: a.key, memo: 'render (reconcile)' }); break;
      case 'swap': if (!hasRef(`swap:${a.sig}`)) book('swap', [['Cash', 'SOL', c.lamports], ['FX', 'SOL', -c.lamports], ['Cash', 'USDC', c.usdcU], ['FX', 'USDC', -c.usdcU]], { ref: `swap:${a.sig}`, memo: 'reconcile' }); break;
      default: break;
    }
    setActionState(a.key, 'confirmed');
    log('reconcile', 'warn', `resolved ${a.kind} ${a.key} from chain`, { sig: a.sig });
  }
}

async function holdings() {
  const owned = new Set(await ownedNfts());
  const sales = salesSeen();
  for (const pos of inventory.openPositions()) {
    if (owned.has(pos.nft_address)) continue;
    const sale = sales.find((s) => JSON.parse(s.nft_mints ?? '{}').out?.includes(pos.nft_address));
    if (sale) {
      if (!hasRef(`sale:${pos.nft_address}:${sale.sig}`)) inventory.bookSale(pos, Math.round(sale.usdc_u / (1 - cfg.ccFee)), sale.sig);
      continue;
    }
    stuckStmt.run('not in wallet and no sale seen', pos.nft_address);
    log('reconcile', 'error', `position ${pos.nft_address} left the wallet without a sale transaction`);
  }
  for (const mint of owned) {
    if (positionStmt.get(mint)) continue;
    const buy = db.prepare("SELECT * FROM actions WHERE nft_address = ? AND kind = 'buy' AND state = 'confirmed'").get(mint);
    if (buy) bookBuy(buy);
  }
}

async function drift() {
  const [chainUsdc, chainSol] = await Promise.all([getUSDCBalance(), getSOLBalance()]);
  const dU = chainUsdc - balance('Cash', 'USDC');
  const dL = chainSol - balance('Cash', 'SOL');
  if (Math.abs(dU) <= 1_000_000 && Math.abs(dL) <= 5_000_000) return;
  const ref = `drift:${now()}`;
  const entries = [];
  if (dU) entries.push(['Cash', 'USDC', dU], ['Equity:Drift', 'USDC', -dU]);
  if (dL) entries.push(['Cash', 'SOL', dL], ['Equity:Drift', 'SOL', -dL]);
  book('drift', entries, { ref, memo: 'chain vs ledger' });
  kvSet('drift_flag', `${dU} usdc / ${dL} lamports at ${now().slice(0, 16)}`);
  log('reconcile', 'error', `balance drift booked: ${dU} usdc, ${dL} lamports. Buys are blocked until POST /api/ack-drift`);
}

export async function reconcile() {
  if (cfg.paper) return;
  await resolveActions();
  await holdings();
  await drift();
}

export const buysBlocked = () => Boolean(kvGet('drift_flag'));
