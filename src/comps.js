// eBay-sold comps for a PSA card via PokemonPriceTracker, cached 24h, with a
// daily credit budget. Response shape is pinned by scripts/ppt-discover.mjs;
// normalizePPT reads the documented fields defensively and reports what it saw.
import { cfg, USDC } from './config.js';
import { db, now, counterInc, counterGet } from './db.js';
import { cardKey, fromCard } from './cards.js';
import { confidence } from './score.js';
import { log } from './log.js';
import * as cc from './cc.js';

const DAY_MS = 86_400_000;
const getStmt = db.prepare('SELECT * FROM comps WHERE card_key = ?');
const putStmt = db.prepare(`INSERT INTO comps (card_key, price_u, n, latest_at, spread_pct, confidence, source, raw_json, fetched_at)
  VALUES (@card_key, @price_u, @n, @latest_at, @spread_pct, @confidence, @source, @raw_json, @fetched_at)
  ON CONFLICT(card_key) DO UPDATE SET price_u=excluded.price_u, n=excluded.n, latest_at=excluded.latest_at, spread_pct=excluded.spread_pct,
  confidence=excluded.confidence, source=excluded.source, raw_json=excluded.raw_json, fetched_at=excluded.fetched_at`);

const tokens = (s) => new Set(String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean));
export function overlap(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / ta.size;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Picks the PPT card matching (number, set, name) and reads the eBay PSA block.
export function normalizePPT(json, identity) {
  const cards = Array.isArray(json) ? json : json?.data ?? json?.cards ?? [];
  const num = String(identity.number).toUpperCase();
  const scored = cards.map((c) => {
    const cnum = String(c.number ?? c.cardNumber ?? c.localId ?? '').replace(/^0+(?=\d)/, '').toUpperCase();
    const setName = c.set?.name ?? c.setName ?? c.set ?? '';
    return { c, numHit: cnum === num, setHit: overlap(identity.set, setName), nameHit: overlap(identity.name, c.name) };
  }).filter((s) => s.numHit && s.nameHit >= 0.5).sort((a, b) => b.setHit - a.setHit || b.nameHit - a.nameHit);
  if (!scored.length) return { priceU: null, n: 0, reason: 'no matching card in response' };
  const { c, nameHit } = scored[0];
  const grade = String(Math.floor(identity.grade));
  const ebay = c.ebay ?? c.prices?.ebay ?? c.graded ?? null;
  const block = ebay?.[`psa${grade}`] ?? ebay?.[`PSA${grade}`] ?? ebay?.psa?.[grade] ?? ebay?.[grade] ?? null;
  if (!block) return { priceU: null, n: 0, reason: `no PSA ${grade} block; keys: ${Object.keys(ebay ?? {}).join(',') || 'none'}` };
  const sales = Array.isArray(block.sales) ? block.sales : Array.isArray(block.recentSales) ? block.recentSales : [];
  const prices = sales.map((s) => Number(s.price ?? s.soldPrice ?? s.amount)).filter((p) => p > 0);
  const market = Number(block.market ?? block.price ?? block.average ?? block.median ?? (prices.length ? median(prices) : 0));
  const dates = sales.map((s) => s.date ?? s.soldAt ?? s.endDate).filter(Boolean).sort();
  const latestAt = dates.at(-1) ?? block.lastSold ?? block.updatedAt ?? c.lastUpdated ?? null;
  const n = Number(block.count ?? block.salesCount ?? block.numSales ?? prices.length);
  const spreadPct = prices.length >= 2 ? ((Math.max(...prices) - Math.min(...prices)) / median(prices)) * 100 : Number(block.spreadPct ?? 0);
  return { priceU: market > 0 ? Math.round(market * USDC) : null, n, latestAt, spreadPct, nameOverlap: nameHit, matched: c.name };
}

export async function fetchPPT(identity) {
  const url = new URL(cfg.pptBase + '/cards');
  url.searchParams.set('search', `${identity.name} ${identity.number}`);
  url.searchParams.set('language', identity.language === 'ja' ? 'japanese' : 'english');
  url.searchParams.set('includeEbay', 'true');
  url.searchParams.set('limit', '10');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.pptKey}`, 'User-Agent': cfg.userAgent } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`ppt ${res.status}: ${json?.error ?? json?.message ?? 'no body'}`);
  return json;
}

export async function getComp(identity, { insuredU = null } = {}) {
  const key = cardKey(identity);
  const cached = getStmt.get(key);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < DAY_MS) return rowToComp(cached);
  if (!cfg.pptKey) return { priceU: null, n: 0, confidence: 'none', source: 'no PPT_KEY' };
  if (counterGet('ppt_credits') >= cfg.pptDailyBudget) {
    return cached ? rowToComp(cached) : { priceU: null, n: 0, confidence: 'none', source: 'ppt budget exhausted' };
  }
  const raw = await fetchPPT(identity);
  counterInc('ppt_credits');
  const norm = normalizePPT(raw, identity);
  const conf = confidence({ ...norm, insuredU });
  const row = {
    card_key: key, price_u: norm.priceU, n: norm.n ?? 0, latest_at: norm.latestAt ?? null, spread_pct: norm.spreadPct ?? null,
    confidence: conf, source: norm.reason ? `ppt: ${norm.reason}` : `ppt: ${norm.matched}`, raw_json: JSON.stringify(raw).slice(0, 20000), fetched_at: now(),
  };
  putStmt.run(row);
  if (norm.reason) log('comps', 'warn', `${key}: ${norm.reason}`);
  return rowToComp(row);
}

const rowToComp = (r) => ({ priceU: r.price_u, n: r.n, latestAt: r.latest_at, spreadPct: r.spread_pct, confidence: r.confidence, source: r.source, fetchedAt: r.fetched_at });

// Cheapest other Buy-now listing of the same cardKey on CC, or null.
export async function venueFloor(identity, excludeNft) {
  const key = cardKey(identity);
  const cards = await cc.find(identity.name, { marketplaceStatus: 'Buy now', marketplaceSource: 'CC' });
  const same = cards.filter((c) => c.nftAddress !== excludeNft && c.listing?.currency === 'USDC' && cardKey(fromCard(c)) === key);
  if (!same.length) return null;
  return Math.min(...same.map((c) => cc.toMicros(c.listing.price)));
}
