// One physical purchase through SP3ND: price the eBay listing, create the order
// shipped to the vault address, pick the cheapest shipping, pay over x402.
// LIVE=1 CONFIRM=yes node scripts/sp3nd-buy.mjs <ebay-url> "<listing title>" [compUsd]
import { createHash } from 'node:crypto';
import { cfg } from '../src/config.js';
import { parseTitle, cardKey } from '../src/cards.js';
import * as sp3nd from '../src/sp3nd.js';

const [url, title, compUsd] = process.argv.slice(2);
if (!url || !title) { console.error('usage: sp3nd-buy.mjs <ebay-url> "<title in CC style: YEAR #NUM Name PSA G Set>" [compUsd]'); process.exit(1); }
if (cfg.paper || process.env.CONFIRM !== 'yes') { console.error('needs LIVE=1 CONFIRM=yes'); process.exit(1); }
if (!cfg.sp3ndShipTo?.address1) { console.error('SP3ND_SHIP_TO must be the vault address of an open Collector Crypt deposit'); process.exit(1); }
const identity = parseTitle(title);
if (!identity) { console.error('title did not parse; use the CC style'); process.exit(1); }

const cart = await sp3nd.priceCart([url]);
console.log('cart', cart.cart_id, JSON.stringify(cart.totals));
const key = 'sp3nd:' + createHash('sha256').update(url).digest('hex').slice(0, 16);
let order = await sp3nd.createOrder(cart.cart_id, key);
console.log('order', order.order_id, order.status, order.pricing_status);
if (order.pricing_status === 'shipping_selection_required' && order.shipping_options?.length) {
  const cheapest = [...order.shipping_options].sort((a, b) => Number(a.price ?? a.amount ?? 0) - Number(b.price ?? b.amount ?? 0))[0];
  await sp3nd.selectShipping(order.order_id, cheapest.shipping_option_id ?? cheapest.id);
  order = await sp3nd.getOrder(order.order_id);
}
for (let i = 0; i < 12 && !order.payment_ready; i++) {
  if (order.status === 'Awaiting Review') { console.log('SP3ND is reviewing this order; rerun once it is payment_ready'); process.exit(0); }
  await new Promise((r) => setTimeout(r, 10_000));
  order = await sp3nd.getOrder(order.order_id);
}
if (!order.payment_ready) { console.error('order not payment_ready after 2 minutes:', order.status, order.pricing_status); process.exit(1); }
const settled = await sp3nd.pay(order.order_id, { identity, cardKey: cardKey(identity), compU: compUsd ? Math.round(Number(compUsd) * 1e6) : null, note: url });
console.log('settled', JSON.stringify(settled).slice(0, 400));
