// Collector Crypt Marketplace V2 client. Read endpoints need no auth; write
// builders return an unsigned base64 tx that the wallet signs and broadcast()
// submits. The WAF drops requests without a User-Agent.
import { cfg, USDC } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { 'User-Agent': cfg.userAgent, Accept: 'application/json' };
export const toDollars = (u) => Number((u / USDC).toFixed(2));
export const toMicros = (dollars) => Math.round(Number(dollars) * USDC);

async function req(method, path, { query, body } = {}) {
  const url = new URL(cfg.ccBase + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body, handled below */ }
    if (!res.ok) {
      const err = new Error(`cc ${method} ${path} ${res.status}: ${json?.message ?? text.slice(0, 200) ?? 'no body'}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }
}

const BASE_FILTERS = {
  categories: 'Pokemon',
  gradingCompany: 'PSA',
  marketplaceStatus: 'Buy now',
  marketplaceSource: 'CC',
};

export function scan({ page = 1, step = 100, orderBy = 'listedPriceAsc', listPriceMin = toDollars(cfg.minTicketU), listPriceMax = toDollars(cfg.maxTicketU) } = {}) {
  return req('GET', '/marketplace', { query: { ...BASE_FILTERS, orderBy, page, step, listPriceMin, listPriceMax } });
}

export async function latest(sinceIso) {
  const out = await req('GET', '/marketplace/latest', { query: { ...BASE_FILTERS, since: sinceIso } });
  return Array.isArray(out) ? out : out?.filterNFtCard ?? [];
}

export async function find(search, extra = {}) {
  const out = await req('GET', '/marketplace', { query: { search, categories: 'Pokemon', step: 50, ...extra } });
  return out?.filterNFtCard ?? [];
}

export async function byNft(nftAddress) {
  const cards = await find(nftAddress);
  return cards.find((c) => c.nftAddress === nftAddress) ?? null;
}

export async function byOwner(wallet) {
  const out = await req('GET', '/marketplace', { query: { ownerAddress: wallet, step: 200 } });
  return out?.filterNFtCard ?? [];
}

// Builders return base64. The docs show a bare string; tolerate a wrapper.
const unwrap = (out) => (typeof out === 'string' ? out : out?.transaction ?? out?.tx ?? out?.serializedTransaction ?? null);

const STANDARD = { pnft: 'Pnft', core: 'Core', nft: 'Nft', cnft: 'Cnft' };
export const tokenStandard = (nftStandard) => STANDARD[String(nftStandard).toLowerCase()] ?? 'Pnft';

export async function buildBuy({ wallet, nftAddress, priceU }) {
  return unwrap(await req('POST', '/marketplace/buy', { body: { wallet, nftAddress, price: toDollars(priceU), currency: 'USDC', fundingSource: 'wallet' } }));
}

async function withSolFallback(path, body) {
  try {
    return unwrap(await req('POST', path, { body: { ...body, userHasSol: true } }));
  } catch (e) {
    if (/INSUFFICIENT_FUNDS_RETRYABLE/.test(e.message)) return unwrap(await req('POST', path, { body: { ...body, userHasSol: false } }));
    throw e;
  }
}

export const buildList = ({ wallet, nftAddress, priceU, nftStandard }) =>
  withSolFallback('/marketplace/list', { wallet, nftAddress, price: toDollars(priceU), currency: 'USDC', tokenStandard: tokenStandard(nftStandard) });

export const buildUpdate = ({ wallet, nftAddress, priceU }) =>
  withSolFallback('/marketplace/update-listing', { wallet, nftAddress, price: toDollars(priceU), currency: 'USDC' });

export const buildCancel = ({ wallet, nftAddress }) => withSolFallback('/marketplace/cancel-listing', { wallet, nftAddress });

export const buildAcceptOffer = ({ wallet, nftAddress, offerId }) => withSolFallback('/marketplace/accept-offer', { wallet, nftAddress, offerId });

export const broadcast = ({ wallet, signedTransaction }) => req('POST', '/marketplace/broadcast', { body: { wallet, signedTransaction } });
