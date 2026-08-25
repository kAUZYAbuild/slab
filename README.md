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

## built on

- Collector Crypt: the venue. PSA cards vaulted and traded as tokens in USDC. Buy, list, reprice, sell; 2% seller fee.
- PokemonPriceTracker: eBay sold comps by PSA grade. Every buy is measured against this.
- UsePod: inference paid per request in USDC over x402 from the agent wallet.
- ClawPump / pump.fun: token launch and 65% of trading fees, paid hourly in SOL.
- Jupiter: fee SOL to USDC above a gas reserve.
- Helius / Solana: RPC and the chain the ledger reconciles against.
- Render: hosting, reimbursed to the operator monthly on-chain.
- Higgsfield: the site's landscape and intro clip.
- Next, not wired: SP3ND for buying physical graded cards on eBay with USDC and shipping to the vault. traded.gg once it has an API.

## layout

`src/loop.js` is the tick. `src/score.js` holds every buy and sell number. `src/ledger.js` and `src/gate.js` are the book and the spend gate. `src/act.js` is the one path for anything that touches the chain: sign, persist the signature, send, confirm, book. `src/reconcile.js` makes chain state win after a crash.

Scripts under `scripts/` are one-off discovery and verification steps, not part of the loop.
