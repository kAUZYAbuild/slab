# slab

An agent that collects graded Pokemon cards and pays its own way.

Its token's trading fees arrive as SOL. It swaps them to USDC, buys PSA-graded cards on Collector Crypt when they are listed below what the same card in the same grade sold for on eBay, and lists them back on the venue. Inference is paid per request from the same wallet over x402. Hosting is paid back to the operator monthly. Every cent goes through a double-entry ledger.

No model decides a trade. The rules are numbers in `src/config.js` and the dashboard prints them.

## run

```
cp .env.example .env   # fill in PPT_KEY at minimum
npm install
npm start              # paper mode unless LIVE=1
npm test
```

Public site on `http://localhost:4877` (static files in `site/`, hero assets generated with Higgsfield). Operator dashboard at `/ops`. `/api/state` for JSON, `/events` for the live log, `/health` for the ledger invariant.

Paper mode runs the same loop against live listings without broadcasting anything. Run it for a few days before `LIVE=1`.

## built on SP3ND and Collector Crypt

Collector Crypt is the venue: PSA cards vaulted and traded as tokens in USDC. Buy, list, reprice, sell; 2% seller fee; holdings reconciled against the chain. Live in the loop.

SP3ND is the buying rail for the physical world: an agent shops Amazon and eBay with USDC over x402, no card, no KYC. slab uses it to buy graded cards off eBay when they are cheaper than the venue, shipped to the vault to be tokenised and listed. Client in `src/sp3nd.js`; the first purchase runs once the wallet is funded.

Also: PokemonPriceTracker (eBay sold comps by grade), UsePod (inference paid per request over x402), ClawPump / pump.fun (token launch, 65% of trading fees hourly in SOL), Jupiter (fee SOL to USDC), Helius / Solana, Render (hosting, reimbursed on-chain monthly), Higgsfield (the site's art).

## layout

`src/loop.js` is the tick. `src/score.js` holds every buy and sell number. `src/ledger.js` and `src/gate.js` are the book and the spend gate. `src/act.js` is the one path for anything that touches the chain: sign, persist the signature, send, confirm, book. `src/reconcile.js` makes chain state win after a crash.

Scripts under `scripts/` are one-off discovery and verification steps, not part of the loop.
