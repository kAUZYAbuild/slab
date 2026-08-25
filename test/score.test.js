import test from 'node:test';
import assert from 'node:assert/strict';
import { score, confidence, listPrice, floorPrice, repriceDown, acceptOffer, haircutFor } from '../src/score.js';

const U = 1_000_000;
const k = {
  minTicketU: 20 * U, maxTicketU: 150 * U, minEdge: 0.15, maxPosPct: 0.25, maxOpen: 6, dailyCapU: 300 * U,
  minCashReserveU: 25 * U, minSolLamports: 20_000_000, ccFee: 0.02, haircut: { 10: 0.92, 9: 0.9, 8: 0.85 },
  nonEnglishPenalty: 0.05, promoPenalty: 0.05, medPenalty: 0.05, floorUndercut: 0.97, sellMargin: 1.05, repriceStep: 0.03,
};
const en9 = { grade: 9, gradingCompany: 'PSA', language: 'en', promo: false };
const base = { identity: en9, bankrollU: 500 * U, cashU: 500 * U, solLamports: 100_000_000, openPositions: 0, spentTodayU: 0, floorU: null };
const comp = (priceU, c = 'high') => ({ priceU, confidence: c });

test('buys when net after haircut and fee clears 15%', () => {
  // comp 50, haircut .9 -> 45, net .98 -> 44.1; at price 38 edge = 6.1 (16%)
  const r = score({ ...base, priceU: 38 * U, comp: comp(50 * U) }, k);
  assert.ok(r.ok, r.reasons.join(','));
  assert.equal(r.expectedU, 45 * U);
  assert.equal(r.netU, 44_100_000);
  assert.equal(r.edgeU, 6_100_000);
});

test('skips just under the edge line', () => {
  const r = score({ ...base, priceU: 39 * U, comp: comp(50 * U) }, k);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /edge/);
});

test('venue floor caps expected sale', () => {
  const r = score({ ...base, priceU: 30 * U, comp: comp(60 * U), floorU: 40 * U }, k);
  assert.equal(r.expectedU, 38_800_000);
});

test('haircuts stack for grade, language, promo, med confidence', () => {
  assert.equal(haircutFor({ grade: 10, language: 'en', promo: false }, 'high', k), 0.92);
  assert.equal(haircutFor({ grade: 9, language: 'ja', promo: true }, 'med', k).toFixed(2), '0.75');
  assert.equal(haircutFor({ grade: 8.5, language: 'en', promo: false }, 'high', k), 0.85);
});

test('rules gate rejects before any math', () => {
  const cases = [
    [{ identity: { ...en9, gradingCompany: 'CGC' } }, /PSA/],
    [{ identity: { ...en9, grade: 7 } }, /grade/],
    [{ priceU: 10 * U }, /min ticket/],
    [{ priceU: 200 * U }, /max ticket/],
    [{ comp: comp(50 * U, 'low') }, /confidence low/],
    [{ comp: null }, /confidence none/],
  ];
  for (const [over, re] of cases) {
    const r = score({ ...base, priceU: 38 * U, comp: comp(50 * U), ...over }, k);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(','), re);
    assert.equal(r.edgeU, null);
  }
});

test('caps: bankroll share, open positions, daily cap, cash reserve, sol', () => {
  const good = { ...base, priceU: 38 * U, comp: comp(60 * U) };
  assert.match(score({ ...good, bankrollU: 100 * U }, k).reasons.join(), /bankroll/);
  assert.match(score({ ...good, openPositions: 6 }, k).reasons.join(), /positions/);
  assert.match(score({ ...good, spentTodayU: 270 * U }, k).reasons.join(), /daily cap/);
  assert.match(score({ ...good, cashU: 60 * U }, k).reasons.join(), /reserve/);
  assert.match(score({ ...good, solLamports: 1000 }, k).reasons.join(), /sol/);
});

test('confidence tiers', () => {
  const at = Date.parse('2026-08-25T00:00:00Z');
  const fresh = new Date(at - 5 * 86_400_000).toISOString();
  const stale = new Date(at - 45 * 86_400_000).toISOString();
  assert.equal(confidence({ n: 6, latestAt: fresh, spreadPct: 10, priceU: 50 * U }, at), 'high');
  assert.equal(confidence({ n: 3, latestAt: fresh, spreadPct: 30, priceU: 50 * U }, at), 'med');
  assert.equal(confidence({ n: 6, latestAt: stale, spreadPct: 10, priceU: 50 * U }, at), 'low');
  assert.equal(confidence({ n: 6, latestAt: fresh, spreadPct: 10, priceU: 50 * U, insuredU: 10 * U }, at), 'low');
  assert.equal(confidence({ n: 6, latestAt: fresh, spreadPct: 10, priceU: 50 * U, nameOverlap: 0.2 }, at), 'low');
  assert.equal(confidence({ n: 0, priceU: 50 * U }, at), 'none');
});

test('sell side never goes under cost x 1.05 net', () => {
  const cost = 40 * U;
  const floor = floorPrice(cost, k);
  assert.equal(floor, Math.ceil((40 * 1.05 * U) / 0.98));
  assert.equal(listPrice({ costU: cost, compU: 60 * U, haircut: 0.9, floorU: null }, k), 54 * U);
  assert.equal(listPrice({ costU: cost, compU: 60 * U, haircut: 0.9, floorU: 50 * U }, k), 49_500_000);
  assert.equal(listPrice({ costU: cost, compU: 41 * U, haircut: 0.9, floorU: null }, k), floor);
  assert.equal(repriceDown(54 * U, cost, k), 52_380_000);
  assert.equal(repriceDown(floor, cost, k), floor);
  assert.equal(acceptOffer(43 * U, cost, k), true);
  assert.equal(acceptOffer(42 * U, cost, k), false);
});
