// SP3ND partner API: an agent shops eBay and Amazon with USDC over x402, no
// card, no KYC. slab uses it to buy graded cards off eBay and ship them to the
// vault. The x402 "exact" scheme on Solana: we sign a USDC transfer whose fee
// payer is SP3ND; they co-sign and settle it. We never broadcast it ourselves.
import { Transaction, TransactionInstruction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { cfg } from './config.js';
import { db, now } from './db.js';
import { authorize } from './gate.js';
import { book } from './ledger.js';
import { connection, getKeypair, pubkey, USDC_MINT } from './wallet.js';
import { log } from './log.js';

export const BASE = 'https://us-central1-sp3nddotshop-prod.cloudfunctions.net';
export const HOST = new URL(BASE).host;
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function call(path, { method = 'POST', body, headers = {}, auth = true } = {}) {
  const h = { 'Content-Type': 'application/json', 'User-Agent': cfg.userAgent, ...headers };
  if (auth) {
    if (!cfg.sp3ndKey || !cfg.sp3ndSecret) throw new Error('SP3ND_API_KEY / SP3ND_API_SECRET not set; run scripts/sp3nd-register.mjs');
    h['X-API-Key'] = cfg.sp3ndKey;
    h['X-API-Secret'] = cfg.sp3ndSecret;
  }
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const ok = (r, what) => {
  if (r.status >= 400) throw new Error(`sp3nd ${what} ${r.status}: ${r.json?.error ?? r.json?.message ?? JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
};

export const register = ({ agentName, email, description }) =>
  call('/registerAgent', { auth: false, body: { agent_name: agentName, solana_public_key: pubkey(), contact_email: email, description } }).then((r) => ok(r, 'registerAgent'));

export const priceCart = (urls) =>
  call('/createPartnerCart', { body: { items: urls.map((u) => ({ product_url: u, quantity: 1 })), user_wallet: pubkey() } }).then((r) => ok(r, 'createPartnerCart').cart);

export const createOrder = (cartId, key) =>
  call('/createPartnerOrder', {
    headers: { 'Idempotency-Key': key },
    body: { cart_id: cartId, idempotency_key: key, user_wallet: pubkey(), customer_email: cfg.sp3ndEmail, shipping_address: cfg.sp3ndShipTo },
  }).then((r) => ok(r, 'createPartnerOrder').order);

export const selectShipping = (orderId, optionId) =>
  call('/selectPartnerOrderShippingOption', { body: { order_id: orderId, shipping_option_id: optionId } }).then((r) => ok(r, 'selectShipping'));

export const getOrder = (orderId) =>
  call(`/getPartnerOrder?order_id=${encodeURIComponent(orderId)}`, { method: 'GET' }).then((r) => ok(r, 'getPartnerOrder')).then((j) => j.order ?? j);

export const atomic = (s) => (String(s).includes('.') ? Math.round(Number(s) * 1_000_000) : Number(s));

export function pick(json) {
  const accepts = Array.isArray(json?.accepts) ? json.accepts : [];
  const a = accepts.find((x) => String(x.network ?? '').startsWith('solana') && x.scheme === 'exact') ?? accepts[0];
  if (!a) return null;
  return {
    network: a.network, payTo: a.payTo ?? a.pay_to, asset: a.asset, amountU: atomic(a.maxAmountRequired ?? a.amount ?? a.amount_microunits),
    feePayer: a.extra?.feePayer ?? a.extra?.fee_payer ?? null, memo: a.extra?.memo ?? a.memo ?? (a.extra?.order_number ? `SP3ND Order: ${a.extra.order_number}` : ''),
    orderId: a.extra?.order_id ?? null, raw: a,
  };
}

// USDC transfer to payTo with SP3ND as fee payer, signed by us only.
export function paymentTransaction(q, blockhash) {
  const kp = getKeypair();
  const dest = new PublicKey(q.payTo);
  const feePayer = q.feePayer ? new PublicKey(q.feePayer) : kp.publicKey;
  const fromAta = getAssociatedTokenAddressSync(USDC_MINT, kp.publicKey);
  const toAta = getAssociatedTokenAddressSync(USDC_MINT, dest, true);
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer }).add(
    createAssociatedTokenAccountIdempotentInstruction(feePayer, toAta, dest, USDC_MINT),
    createTransferInstruction(fromAta, toAta, kp.publicKey, BigInt(q.amountU)),
  );
  if (q.memo) tx.add(new TransactionInstruction({ keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], programId: MEMO_PROGRAM, data: Buffer.from(q.memo, 'utf8') }));
  tx.partialSign(kp);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

export const paymentHeader = (q, transaction) =>
  Buffer.from(JSON.stringify({ x402Version: 2, scheme: 'exact', network: q.network, payload: { transaction } })).toString('base64');

const insPosition = db.prepare(`INSERT INTO positions (nft_address, card_key, identity_json, cost_u, bought_at, state, comp_at_buy_u, note)
  VALUES (?, ?, ?, ?, ?, 'shipping', ?, ?)`);
const insAction = db.prepare(`INSERT OR IGNORE INTO actions (key, kind, nft_address, amount_u, state, gate, reason, sig, created_at, updated_at)
  VALUES (?, 'buy', ?, ?, 'confirmed', 'ok', 'sp3nd', ?, ?, ?)`);

export async function pay(orderId, { identity, cardKey, compU = null, note = '' }) {
  const ref = `sp3nd:${orderId}`;
  const first = await call('/payAgentOrder', { body: { order_id: orderId } });
  if (first.status !== 402) return ok(first, 'payAgentOrder');
  const q = pick(first.json);
  if (!q?.payTo || !Number.isInteger(q.amountU)) throw new Error(`sp3nd 402 unreadable: ${JSON.stringify(first.json).slice(0, 300)}`);
  if (!/usdc/i.test(String(q.asset)) && q.asset !== USDC_MINT.toBase58()) throw new Error(`sp3nd asks for ${q.asset}, not USDC`);
  const g = authorize({ kind: 'buy', amountU: q.amountU, ref, host: HOST });
  if (!g.allowed) throw new Error(`sp3nd buy denied at ${g.gate}: ${g.reason}`);
  if (cfg.paper) throw new Error('paper mode: not paying a real order');
  const { blockhash } = await connection.getLatestBlockhash();
  const transaction = paymentTransaction(q, blockhash);
  const second = await call('/payAgentOrder', { headers: { 'PAYMENT-SIGNATURE': paymentHeader(q, transaction) }, body: { order_id: orderId } });
  const settled = ok(second, 'payAgentOrder (settle)');
  const t = now();
  book('buy', [['Inventory', 'USDC', q.amountU], ['Cash', 'USDC', -q.amountU]], { ref, memo: `sp3nd ${identity?.name ?? ''} ${note}`.trim() });
  insPosition.run(ref, cardKey, JSON.stringify(identity), q.amountU, t, compU, note || 'bought on ebay via sp3nd, shipping to the vault');
  insAction.run(ref, ref, q.amountU, settled?.order?.order_number ?? orderId, t, t);
  log('sp3nd', 'info', `paid order ${orderId}: ${q.amountU}u`, { ref });
  return settled;
}

// Once the card is vaulted and the NFT lands in the wallet, tie them together.
export const link = (orderId, nftAddress) =>
  db.prepare("UPDATE positions SET nft_address = ?, state = 'held', note = COALESCE(note, '') || ' vaulted' WHERE nft_address = ? AND state = 'shipping'").run(nftAddress, `sp3nd:${orderId}`).changes;
