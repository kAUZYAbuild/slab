// Every buy and sell number lives here. Pure functions over integer base units.
import { cfg } from './config.js';

const DAY = 86_400_000;

export function confidence({ n, latestAt, spreadPct, priceU, insuredU, nameOverlap }, at = Date.now()) {
  if (!priceU || !n) return 'none';
  const ageDays = latestAt ? (at - Date.parse(latestAt)) / DAY : Infinity;
  if (insuredU && (priceU < insuredU * 0.33 || priceU > insuredU * 3)) return 'low';
  if (nameOverlap != null && nameOverlap < 0.6) return 'low';
  if (n >= 5 && ageDays <= 14 && spreadPct <= 25) return 'high';
  if (n >= 3 && ageDays <= 30 && spreadPct <= 35) return 'med';
  return 'low';
}

export function haircutFor(identity, conf, k = cfg) {
  const g = Math.floor(identity.grade);
  let h = k.haircut[g] ?? k.haircut[8];
  if (identity.language !== 'en') h -= k.nonEnglishPenalty;
  if (identity.promo) h -= k.promoPenalty;
  if (conf === 'med') h -= k.medPenalty;
  return h;
}

export function score(x, k = cfg) {
  const { priceU, comp, identity } = x;
  const reasons = [];
  if (identity.gradingCompany !== 'PSA') reasons.push('not PSA');
  if (!(identity.grade >= 8)) reasons.push('grade under 8');
  if (priceU < k.minTicketU) reasons.push('under min ticket');
  if (priceU > k.maxTicketU) reasons.push('over max ticket');
  const conf = comp?.confidence ?? 'none';
  if (conf !== 'high' && conf !== 'med') reasons.push(`comp confidence ${conf}`);
  if (reasons.length) return { ok: false, reasons, edgeU: null, edgePct: null, expectedU: null, netU: null, haircut: null };

  const haircut = haircutFor(identity, conf, k);
  let expectedU = Math.floor(comp.priceU * haircut);
  if (x.floorU != null) expectedU = Math.min(expectedU, Math.floor(x.floorU * k.floorUndercut));
  const netU = Math.floor(expectedU * (1 - k.ccFee));
  const edgeU = netU - priceU;
  const edgePct = edgeU / priceU;

  if (edgePct < k.minEdge) reasons.push(`edge ${(edgePct * 100).toFixed(1)}% under ${k.minEdge * 100}%`);
  if (priceU > k.maxPosPct * x.bankrollU) reasons.push(`over ${k.maxPosPct * 100}% of bankroll`);
  if (x.openPositions >= k.maxOpen) reasons.push(`${k.maxOpen} positions open`);
  if (x.spentTodayU + priceU > k.dailyCapU) reasons.push('daily cap');
  if (x.cashU - priceU < k.minCashReserveU) reasons.push('cash reserve');
  if (x.solLamports < k.minSolLamports) reasons.push('sol gas reserve');
  return { ok: reasons.length === 0, reasons, edgeU, edgePct, expectedU, netU, haircut };
}

export const floorPrice = (costU, k = cfg) => Math.ceil((costU * k.sellMargin) / (1 - k.ccFee));

export function listPrice({ costU, compU, haircut, floorU }, k = cfg) {
  const floor = floorPrice(costU, k);
  let target = Math.floor(compU * haircut);
  if (floorU != null) target = Math.min(target, Math.floor(floorU * 0.99));
  return Math.max(floor, target);
}

export const repriceDown = (currentU, costU, k = cfg) => Math.max(floorPrice(costU, k), Math.floor(currentU * (1 - k.repriceStep)));

export const acceptOffer = (offerU, costU, k = cfg) => Math.floor(offerU * (1 - k.ccFee)) >= Math.ceil(costU * k.sellMargin);
