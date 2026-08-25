// Positions: what we hold, what it is listed for, when it sold.
import { cfg } from './config.js';
import { db, now } from './db.js';
import { book } from './ledger.js';
import { cardKey } from './cards.js';
import { listPrice, repriceDown, haircutFor, floorPrice } from './score.js';
import { perform } from './act.js';
import * as cc from './cc.js';
import { log } from './log.js';

const DAY_MS = 86_400_000;
const openStmt = db.prepare(`INSERT INTO positions (nft_address, card_key, identity_json, cost_u, buy_action_id, bought_at, state, comp_at_buy_u, note)
  VALUES (?, ?, ?, ?, ?, ?, 'held', ?, ?)`);
const byStateStmt = db.prepare('SELECT * FROM positions WHERE state = ? ORDER BY id');
const compStmt = db.prepare('SELECT * FROM comps WHERE card_key = ?');
const listedStmt = db.prepare('UPDATE positions SET state = ?, list_price_u = ?, listed_at = COALESCE(listed_at, ?), last_reprice_at = ? WHERE nft_address = ?');
const soldStmt = db.prepare("UPDATE positions SET state = 'sold', sold_u = ?, sold_at = ?, sale_sig = ? WHERE nft_address = ?");
const stuckStmt = db.prepare("UPDATE positions SET state = 'stuck', note = ? WHERE nft_address = ?");

export const positions = (state) => byStateStmt.all(state);
export const openPositions = () => [...positions('held'), ...positions('listed'), ...positions('shipping')];
export const allPositions = () => db.prepare('SELECT * FROM positions ORDER BY id DESC').all();

export function open({ nftAddress, identity, costU, actionId, compU, note = null }) {
  openStmt.run(nftAddress, cardKey(identity), JSON.stringify(identity), costU, actionId, now(), compU, note);
}

function targetPrice(pos, floorU) {
  const identity = JSON.parse(pos.identity_json);
  const comp = compStmt.get(pos.card_key);
  if (!comp?.price_u) return floorPrice(pos.cost_u);
  return listPrice({ costU: pos.cost_u, compU: comp.price_u, haircut: haircutFor(identity, comp.confidence), floorU });
}

async function floorFor(pos) {
  if (cfg.paper) return null;
  const identity = JSON.parse(pos.identity_json);
  const cards = await cc.find(identity.name, { marketplaceStatus: 'Buy now', marketplaceSource: 'CC' });
  const same = cards.filter((c) => c.nftAddress !== pos.nft_address && c.listing?.currency === 'USDC');
  return same.length ? Math.min(...same.map((c) => cc.toMicros(c.listing.price))) : null;
}

export async function listHeld(wallet) {
  for (const pos of positions('held')) {
    const priceU = targetPrice(pos, await floorFor(pos));
    const listing = db.prepare('SELECT nft_standard FROM listings_seen WHERE nft_address = ?').get(pos.nft_address);
    await perform({
      key: `list:${pos.nft_address}:${pos.id}`, kind: 'list', nftAddress: pos.nft_address, amountU: priceU,
      build: () => cc.buildList({ wallet, nftAddress: pos.nft_address, priceU, nftStandard: listing?.nft_standard }),
      send: (signedTransaction) => cc.broadcast({ wallet, signedTransaction }),
      onConfirmed: () => {
        listedStmt.run('listed', priceU, now(), now(), pos.nft_address);
        log('inventory', 'info', `listed ${pos.nft_address.slice(0, 6)} at ${priceU}u`, { costU: pos.cost_u });
      },
    }).catch((e) => log('inventory', 'error', `list failed: ${e.message}`, { nft: pos.nft_address }));
  }
}

export async function repriceDue(wallet) {
  const cutoff = Date.now() - cfg.repriceDays * DAY_MS;
  for (const pos of positions('listed')) {
    if (Date.parse(pos.last_reprice_at ?? pos.listed_at) > cutoff) continue;
    const floor = floorPrice(pos.cost_u);
    if (pos.list_price_u <= floor) {
      if (Date.now() - Date.parse(pos.listed_at) > cfg.stuckDays * DAY_MS) {
        stuckStmt.run(`at floor ${floor}u for ${cfg.stuckDays}d`, pos.nft_address);
        log('inventory', 'warn', `stuck: ${pos.nft_address.slice(0, 6)} at floor for ${cfg.stuckDays} days`);
      }
      continue;
    }
    const priceU = repriceDown(pos.list_price_u, pos.cost_u);
    await perform({
      key: `update:${pos.nft_address}:${priceU}`, kind: 'update', nftAddress: pos.nft_address, amountU: priceU,
      build: () => cc.buildUpdate({ wallet, nftAddress: pos.nft_address, priceU }),
      send: (signedTransaction) => cc.broadcast({ wallet, signedTransaction }),
      onConfirmed: () => {
        listedStmt.run('listed', priceU, pos.listed_at, now(), pos.nft_address);
        log('inventory', 'info', `repriced ${pos.nft_address.slice(0, 6)} ${pos.list_price_u}u -> ${priceU}u`);
      },
    }).catch((e) => log('inventory', 'error', `reprice failed: ${e.message}`, { nft: pos.nft_address }));
  }
}

export function bookSale(pos, grossU, sig) {
  const feeU = Math.round(grossU * cfg.ccFee);
  const netU = grossU - feeU;
  book('sale', [
    ['Cash', 'USDC', netU], ['Expense:PlatformFee', 'USDC', feeU], ['Revenue:Sales', 'USDC', -grossU],
    ['COGS', 'USDC', pos.cost_u], ['Inventory', 'USDC', -pos.cost_u],
  ], { ref: `sale:${pos.nft_address}:${sig ?? pos.id}`, memo: pos.card_key });
  soldStmt.run(grossU, now(), sig, pos.nft_address);
  log('inventory', 'info', `sold ${pos.nft_address.slice(0, 6)} for ${grossU}u (cost ${pos.cost_u}u)`, { netU, sig });
}

// Paper sales are a simulation and optimistic by construction: a competing
// listing of the same card at or above our price disappearing counts as our
// sale, and anything sitting at floor for paperSellDays sells at floor.
const goneAboveStmt = db.prepare(`SELECT 1 FROM listings_seen WHERE card_key = ? AND status = 'gone' AND price_u >= ? AND seen_at > ? LIMIT 1`);
export function paperSales() {
  for (const pos of positions('listed')) {
    const listedAt = pos.listed_at;
    const competitorGone = goneAboveStmt.get(pos.card_key, pos.list_price_u, listedAt);
    const atFloorLongEnough = pos.list_price_u <= floorPrice(pos.cost_u) && Date.now() - Date.parse(listedAt) > cfg.paperSellDays * DAY_MS;
    if (competitorGone || atFloorLongEnough) bookSale(pos, pos.list_price_u, null);
  }
}
