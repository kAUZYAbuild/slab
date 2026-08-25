// UsePod x402 client. Every inference call is paid per request from the
// agent wallet: request -> 402 with a quote -> USDC transfer -> retry with the
// payment signature. The quoted amount is a ceiling; unused amounts come back
// to the wallet and the fee watcher books them as refunds.
import { cfg } from './config.js';
import { db, now } from './db.js';
import { authorize } from './gate.js';
import { book } from './ledger.js';
import { buildUSDCTransfer, sendRaw, confirm, pubkey, hasKey, signMessage, USDC_MINT } from './wallet.js';
import { kvSet, kvGet } from './db.js';
import { log } from './log.js';

const insCall = db.prepare(`INSERT INTO llm_calls (quote_id, purpose, model, quoted_u, state, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
const paidCall = db.prepare(`UPDATE llm_calls SET paid_u = ?, pay_sig = ?, state = 'paid' WHERE quote_id = ?`);
const doneCall = db.prepare(`UPDATE llm_calls SET in_tokens = ?, out_tokens = ?, state = 'done' WHERE quote_id = ?`);
const failCall = db.prepare(`UPDATE llm_calls SET state = 'failed' WHERE quote_id = ?`);

// x402 v2: the header carries an accepts[] list; we take the Solana USDC option.
export const decodeRequired = (header) => {
  const q = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  const accepts = Array.isArray(q.accepts) ? q.accepts : [q];
  const opt = accepts.find((a) => String(a.network ?? '').startsWith('solana') && /usdc/i.test(String(a.asset ?? '')) && a.scheme !== 'balance')
    ?? accepts.find((a) => String(a.network ?? '').startsWith('solana'));
  if (!opt) return { quoteId: q.quote_id ?? null, raw: q };
  const rawAmount = opt.amount_microunits ?? opt.amount ?? opt.maxAmountRequired;
  return {
    quoteId: opt.quote_id ?? q.quote_id ?? q.quoteId,
    payTo: opt.pay_to ?? opt.payTo,
    amountU: Number(rawAmount),
    asset: opt.asset,
    network: opt.network,
    scheme: opt.scheme,
    mode: opt.mode ?? null,
    expiresAt: opt.expires_at ?? null,
    bodyHash: opt.body_hash ?? null,
    balanceScheme: Boolean(opt.balance_hint) || accepts.some((a) => a.scheme === 'balance'),
    raw: q,
  };
};

export const encodeSignature = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

const isUsdc = (asset) => asset === 'USDC' || asset === USDC_MINT.toBase58() || /usdc/i.test(String(asset));

export async function messages(body, { purpose = 'llm' } = {}) {
  if (!hasKey()) throw new Error('no wallet key; inference is unavailable');
  if (!cfg.usepodModel) throw new Error('USEPOD_MODEL not set');
  const payload = JSON.stringify({ model: cfg.usepodModel, ...body });
  const url = cfg.usepodBase + '/messages';
  const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'User-Agent': cfg.userAgent };
  const send = (extra = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: payload });

  const first = await send();
  if (first.status !== 402) return finish(first, null, purpose);

  const header = first.headers.get('payment-required') ?? first.headers.get('x-payment-required');
  if (!header) throw new Error('usepod 402 without PAYMENT-REQUIRED header');
  const q = decodeRequired(header);
  if (!q.quoteId || !q.payTo || !Number.isInteger(q.amountU)) throw new Error(`usepod quote unreadable: ${JSON.stringify(q.raw).slice(0, 300)}`);
  if (!isUsdc(q.asset)) throw new Error(`usepod quote asset ${q.asset} is not USDC`);
  const ref = `x402:${q.quoteId}`;
  insCall.run(q.quoteId, purpose, cfg.usepodModel, q.amountU, 'quoted', now());
  kvSet('usepod_payto', [...new Set([...(kvGet('usepod_payto') ?? '').split(',').filter(Boolean), q.payTo])].join(','));

  // Unused cap from earlier calls sits as a balance on their side keyed to our
  // wallet. Spending it needs a signature, not a transaction. Unverified until
  // scripts/x402-ping.mjs has run twice; falls back to paying on-chain.
  if (q.balanceScheme && Number(kvGet('usepod_surplus_u') ?? 0) >= q.amountU) {
    const proof = signMessage(`usepod-x402-spend:${q.quoteId}`);
    const viaBalance = await send({ 'PAYMENT-SIGNATURE': encodeSignature({ x402_version: 2, scheme: 'balance', network: q.network, asset: q.asset, quote_id: q.quoteId, payer_wallet: pubkey(), payload: { proof } }) });
    if (viaBalance.status !== 402) {
      paidCall.run(0, null, q.quoteId);
      return finish(viaBalance, q.quoteId, purpose);
    }
    log('usepod', 'warn', 'balance scheme rejected, paying on-chain', { quoteId: q.quoteId });
  }

  const g = authorize({ kind: 'llm', amountU: q.amountU, ref, host: 'api.usepod.ai' });
  if (!g.allowed) {
    failCall.run(q.quoteId);
    throw new Error(`inference denied at ${g.gate}: ${g.reason}`);
  }
  const { sig, signedBase64 } = await buildUSDCTransfer(q.payTo, q.amountU, q.quoteId);
  await sendRaw(signedBase64);
  const status = await confirm(sig);
  if (status !== 'ok') {
    failCall.run(q.quoteId);
    throw new Error(`x402 payment ${status} (${sig})`);
  }
  paidCall.run(q.amountU, sig, q.quoteId);
  book('llm', [['Expense:Compute', 'USDC', q.amountU], ['Cash', 'USDC', -q.amountU]], { ref, memo: `${purpose} ${cfg.usepodModel}` });

  const second = await send({ 'PAYMENT-SIGNATURE': encodeSignature({ quote_id: q.quoteId, network: q.network, asset: q.asset, payer_wallet: pubkey(), signature: sig }) });
  return finish(second, q.quoteId, purpose);
}

async function finish(res, quoteId, purpose) {
  const json = await res.json().catch(() => null);
  const receipt = res.headers.get('payment-response');
  if (receipt) {
    let r = null;
    try { r = JSON.parse(Buffer.from(receipt, 'base64').toString('utf8')); } catch { r = { raw: receipt.slice(0, 200) }; }
    const surplus = r?.surplus_microunits ?? r?.balance_microunits ?? r?.surplus ?? r?.balance;
    if (surplus != null) kvSet('usepod_surplus_u', Number(surplus));
    log('usepod', 'info', `receipt ${JSON.stringify(r).slice(0, 300)}`, { quoteId });
  }
  if (!res.ok) {
    if (quoteId) failCall.run(quoteId);
    throw new Error(`usepod ${res.status}: ${json?.error?.message ?? json?.message ?? 'no body'}`);
  }
  if (!quoteId) insCall.run(`free:${now()}:${Math.random().toString(36).slice(2, 8)}`, purpose, cfg.usepodModel, 0, 'done', now());
  else doneCall.run(json?.usage?.input_tokens ?? null, json?.usage?.output_tokens ?? null, quoteId);
  return json;
}

// Book any call that was paid but not booked (crash between pay and book) and
// expire stale quotes.
export function bookkeeping() {
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  db.prepare(`UPDATE llm_calls SET state = 'failed' WHERE state = 'quoted' AND created_at < ?`).run(stale);
  for (const c of db.prepare(`SELECT * FROM llm_calls WHERE state IN ('paid','done') AND paid_u > 0`).all()) {
    const ref = `x402:${c.quote_id}`;
    if (db.prepare('SELECT 1 FROM txn WHERE ref = ?').get(ref)) continue;
    book('llm', [['Expense:Compute', 'USDC', c.paid_u], ['Cash', 'USDC', -c.paid_u]], { ref, memo: `${c.purpose} ${c.model} (late booking)` });
    log('usepod', 'warn', `booked late: ${ref}`);
  }
}

export const text = (json) => (json?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
