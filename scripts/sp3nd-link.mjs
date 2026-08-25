// After the vault tokenises the card: node scripts/sp3nd-link.mjs <order_id> <nftAddress>
import { link } from '../src/sp3nd.js';
const [orderId, nft] = process.argv.slice(2);
if (!orderId || !nft) { console.error('usage: sp3nd-link.mjs <order_id> <nftAddress>'); process.exit(1); }
console.log(link(orderId, nft) ? 'linked' : 'no shipping position for that order');
