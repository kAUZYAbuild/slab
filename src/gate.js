// A spend clears three gates in order: rules, caps, funds. Each fails for a
// different reason so the binding constraint is visible. Denials are logged;
// the caller decides what to persist.
import { cfg } from './config.js';
import { today } from './db.js';
import { balance, hasRef, spentSince } from './ledger.js';
import { log } from './log.js';

const HOSTS = new Set(['api.collectorcrypt.com', 'dev-api.collectorcrypt.com', 'api.usepod.ai', 'lite-api.jup.ag', 'us-central1-sp3nddotshop-prod.cloudfunctions.net', 'solana']);

export function authorize({ kind, amountU, ref, host }) {
  const deny = (gate, reason) => {
    log('gate', 'warn', `denied ${kind} ${amountU}u: ${reason}`, { gate, ref });
    return { allowed: false, gate, reason };
  };
  if (ref && hasRef(ref)) return { allowed: true, gate: 'ok', reason: 'already booked' };

  if (!Number.isInteger(amountU) || amountU <= 0) return deny('rules', 'amount must be a positive integer');
  if (!ref) return deny('rules', 'missing idempotency ref');
  if (!HOSTS.has(host)) return deny('rules', `host ${host} not in allowlist`);

  const dayStart = today() + 'T00:00:00.000Z';
  if (kind === 'buy') {
    if (amountU > cfg.maxTicketU) return deny('caps', `over max ticket ${cfg.maxTicketU}u`);
    const spent = spentSince('buy', dayStart);
    if (spent + amountU > cfg.dailyCapU) return deny('caps', `daily cap: spent ${spent}u today, cap ${cfg.dailyCapU}u`);
  } else if (kind === 'llm') {
    if (amountU > cfg.llmMaxCallU) return deny('caps', `over per-call cap ${cfg.llmMaxCallU}u`);
    const spent = spentSince('llm', dayStart);
    if (spent + amountU > cfg.llmDailyCapU) return deny('caps', `llm daily cap: spent ${spent}u, cap ${cfg.llmDailyCapU}u`);
  } else if (kind === 'hosting') {
    if (amountU !== cfg.hostingU) return deny('caps', `hosting must be exactly ${cfg.hostingU}u`);
  } else if (kind === 'transfer' || kind === 'swap') {
    if (kind === 'transfer' && amountU > cfg.maxTransferU) return deny('caps', `over max transfer ${cfg.maxTransferU}u`);
  } else {
    return deny('rules', `unknown spend kind ${kind}`);
  }

  const currency = kind === 'swap' ? 'SOL' : 'USDC';
  const cash = balance('Cash', currency);
  const reserve = kind === 'buy' ? cfg.minCashReserveU : 0;
  if (cash - amountU < reserve) {
    return deny('funds', `cash ${cash} ${currency} minus ${amountU} is under reserve ${reserve}`);
  }
  return { allowed: true, gate: 'ok', reason: 'authorized' };
}
