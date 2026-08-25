// Builds, signs and broadcasts a listing on Collector Crypt devnet for an NFT
// you already hold there, then tries again and expects a 409.
// CC_BASE=https://dev-api.collectorcrypt.com SOLANA_RPC_URL=https://api.devnet.solana.com node scripts/devnet-cc.mjs <nftAddress> <priceUsd> [pnft|core|nft]
import { cfg } from '../src/config.js';
import * as cc from '../src/cc.js';
import { pubkey, signTx, confirm } from '../src/wallet.js';

const [nftAddress, price, std = 'pnft'] = process.argv.slice(2);
if (!nftAddress || !price) { console.error('usage: devnet-cc.mjs <nftAddress> <priceUsd> [standard]'); process.exit(1); }
if (!/dev-api/.test(cfg.ccBase)) { console.error('refusing: CC_BASE is not devnet'); process.exit(1); }
const wallet = pubkey();
const unsigned = await cc.buildList({ wallet, nftAddress, priceU: cc.toMicros(price), nftStandard: std });
const { sig, signedBase64 } = signTx(unsigned);
console.log('signed', sig);
console.log('broadcast', await cc.broadcast({ wallet, signedTransaction: signedBase64 }));
console.log('confirm', await confirm(sig));
try {
  await cc.buildList({ wallet, nftAddress, priceU: cc.toMicros(price), nftStandard: std });
  console.log('second list did not 409; check whether the first landed');
} catch (e) {
  console.log('second list ->', e.status, e.message.slice(0, 120));
}
