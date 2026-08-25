import { cfg } from './config.js';
import { db, now, today, kvGet, kvSet, runMark } from './db.js';
import { book, balance, spentSince } from './ledger.js';
import { fromCard, cardKey, isComplete } from './cards.js';
import { score } from './score.js';
import { getComp, venueFloor } from './comps.js';
import { authorize } from './gate.js';
import { perform, recordDenied } from './act.js';
import * as cc from './cc.js';
import * as inventory from './inventory.js';
import { hasKey, pubkey, getUSDCBalance, getSOLBalance } from './wallet.js';
import { log } from './log.js';

const MIN = 60_000;
const upsertListing = db.prepare(`INSERT INTO listings_seen
  (nft_address, item_name, card_key, identity_json, price_u, owner, listed_at, seen_at, status, insured_u, grade_num, grading_company, nft_standard)
  VALUES (@nft_address, @item_name, @card_key, @identity_json, @price_u, @owner, @listed_at, @seen_at, 'new', @insured_u, @grade_num, @grading_company, @nft_standard)
  ON CONFLICT(nft_address) DO UPDATE SET
    seen_at = excluded.seen_at, owner = excluded.owner, listed_at = excluded.listed_at,
    status = CASE WHEN listings_seen.price_u != excluded.price_u AND listings_seen.status != 'bought' THEN 'new' ELSE listings_seen.status END,
    price_u = excluded.price_u`);
// Comps credits are scarce, so score the listings priced lowest against CC's own insured value first.
const newListings = db.prepare(`SELECT * FROM listings_seen WHERE status = 'new'
  ORDER BY CASE WHEN insured_u > 0 THEN price_u * 1.0 / insured_u ELSE 9 END ASC, seen_at DESC LIMIT 40`);
const setStatus = db.prepare('UPDATE listings_seen SET status = ?, skip_reason = ?, score_json = ? WHERE nft_address = ?');
const bestScored = db.prepare(`SELECT * FROM listings_seen WHERE status = 'scored' AND seen_at > ?
  ORDER BY json_extract(score_json, '$.edgePct') DESC LIMIT 1`);
const markGone = db.prepare("UPDATE listings_seen SET status = 'gone' WHERE seen_at < ? AND status IN ('new','scored','skipped')");

let inFlight = false;
let lastTickAt = null;
export const status = () => ({ lastTickAt, inFlight });

function due(name, everyMs) {
  const last = kvGet(`due:${name}`);
  if (last && Date.now() - Date.parse(last) < everyMs) return false;
  kvSet(`due:${name}`, now());
  return true;
}

async function step(name, fn) {
  try {
    await fn();
    runMark(name, true);
  } catch (e) {
    runMark(name, false, e.message);
    log(name, 'error', e.message);
  }
}

export function wallet() {
  return cfg.paper && !hasKey() ? 'paper' : pubkey();
}

async function balances() {
  const cashU = balance('Cash');
  if (cfg.paper) return { cashU, solLamports: cfg.solReserveLamports + cfg.minSolLamports, chainUsdcU: null };
  const [chainUsdcU, solLamports] = await Promise.all([getUSDCBalance(), getSOLBalance()]);
  return { cashU, solLamports, chainUsdcU };
}

function ingest(cards) {
  const t = now();
  let n = 0;
  for (const c of cards) {
    if (!c?.nftAddress || !c.listing || c.listing.currency !== 'USDC') continue;
    const identity = fromCard(c);
    upsertListing.run({
      nft_address: c.nftAddress, item_name: c.itemName, card_key: cardKey(identity), identity_json: JSON.stringify(identity),
      price_u: cc.toMicros(c.listing.price), owner: c.owner?.wallet ?? null, listed_at: c.listedAt ?? c.listing.createdAt ?? null, seen_at: t,
      insured_u: c.insuredValue ? cc.toMicros(c.insuredValue) : null, grade_num: identity.grade, grading_company: identity.gradingCompany, nft_standard: c.nftStandard ?? null,
    });
    n++;
  }
  return n;
}

async function scan() {
  if (due('sweep', 30 * MIN)) {
    const start = now();
    let total = 0;
    for (let page = 1; page <= 5; page++) {
      const out = await cc.scan({ page, step: 1000 });
      total += ingest(out?.filterNFtCard ?? []);
      if (page >= (out?.totalPages ?? 1)) break;
    }
    const gone = markGone.run(start).changes;
    log('scan', 'info', `sweep: ${total} listings, ${gone} gone`);
    kvSet('latest_since', start);
    return;
  }
  if (!due('latest', 2 * MIN)) return;
  const since = kvGet('latest_since') ?? new Date(Date.now() - 60 * MIN).toISOString();
  const cards = await cc.latest(since);
  const n = ingest(cards);
  kvSet('latest_since', now());
  if (n) log('scan', 'info', `latest: ${n} new or changed`);
}

async function scoreNew() {
  const b = await balances();
  const ctx = {
    bankrollU: b.cashU + balance('Inventory'), cashU: b.cashU, solLamports: b.solLamports,
    openPositions: inventory.openPositions().length, spentTodayU: spentSince('buy', today() + 'T00:00:00.000Z'),
  };
  for (const row of newListings.all()) {
    const identity = JSON.parse(row.identity_json);
    const skip = (reason) => setStatus.run('skipped', reason, null, row.nft_address);
    if (identity.gradingCompany !== 'PSA') { skip('not PSA'); continue; }
    if (!(identity.grade >= 8)) { skip('grade under 8'); continue; }
    if (row.price_u < cfg.minTicketU || row.price_u > cfg.maxTicketU) { skip('outside ticket band'); continue; }
    if (!isComplete(identity)) { skip('unparsed title'); continue; }
    let comp;
    try {
      comp = await getComp(identity, { insuredU: row.insured_u });
    } catch (e) {
      log('score', 'error', `comps unavailable, pausing scoring this tick: ${e.message}`);
      break;
    }
    let s = score({ ...ctx, priceU: row.price_u, comp, identity, floorU: null });
    if (s.ok) {
      const floorU = await venueFloor(identity, row.nft_address);
      s = score({ ...ctx, priceU: row.price_u, comp, identity, floorU });
      s.floorU = floorU;
    }
    s.compU = comp.priceU;
    s.confidence = comp.confidence;
    setStatus.run(s.ok ? 'scored' : 'skipped', s.ok ? null : s.reasons.join('; '), JSON.stringify(s), row.nft_address);
    if (s.ok) log('score', 'info', `candidate ${row.item_name} at ${row.price_u}u, edge ${(s.edgePct * 100).toFixed(1)}%`);
  }
}

async function buy() {
  const row = bestScored.get(new Date(Date.now() - 30 * MIN).toISOString());
  if (!row) return;
  const identity = JSON.parse(row.identity_json);
  const s = JSON.parse(row.score_json);
  const key = `buy:${row.nft_address}:${row.listed_at ?? row.seen_at}`;
  const w = wallet();
  if (!cfg.paper) {
    const live = await cc.byNft(row.nft_address);
    if (!live?.listing || cc.toMicros(live.listing.price) !== row.price_u || live.owner?.wallet !== row.owner) {
      setStatus.run('new', null, null, row.nft_address);
      log('buy', 'warn', `listing changed before buy, rescoring ${row.nft_address.slice(0, 6)}`);
      return;
    }
  }
  const g = authorize({ kind: 'buy', amountU: row.price_u, ref: key, host: new URL(cfg.ccBase).host });
  if (!g.allowed) {
    recordDenied({ key, kind: 'buy', nftAddress: row.nft_address, amountU: row.price_u, gate: g.gate, reason: g.reason });
    setStatus.run('skipped', `gate ${g.gate}: ${g.reason}`, row.score_json, row.nft_address);
    return;
  }
  await perform({
    key, kind: 'buy', nftAddress: row.nft_address, amountU: row.price_u,
    build: () => cc.buildBuy({ wallet: w, nftAddress: row.nft_address, priceU: row.price_u }),
    send: (signedTransaction) => cc.broadcast({ wallet: w, signedTransaction }),
    onConfirmed: (action) => {
      book('buy', [['Inventory', 'USDC', row.price_u], ['Cash', 'USDC', -row.price_u]], { ref: key, memo: row.item_name });
      inventory.open({ nftAddress: row.nft_address, identity, costU: row.price_u, actionId: action.id, compU: s.compU });
      setStatus.run('bought', null, row.score_json, row.nft_address);
      log('buy', 'info', `bought ${row.item_name} for ${row.price_u}u (comp ${s.compU}u, edge ${(s.edgePct * 100).toFixed(1)}%)`, { key });
    },
  });
}

async function manageInventory() {
  if (!due('inventory', 5 * MIN)) return;
  const w = wallet();
  await inventory.listHeld(w);
  await inventory.repriceDue(w);
  if (cfg.paper) inventory.paperSales();
}

export async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    await step('scan', scan);
    await step('score', scoreNew);
    await step('buy', buy);
    await step('inventory', manageInventory);
    lastTickAt = now();
  } finally {
    inFlight = false;
  }
}

export function start() {
  const run = async () => {
    await tick();
    setTimeout(run, cfg.tickMs);
  };
  run();
}
