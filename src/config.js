import 'dotenv/config';

const env = process.env;
const num = (k, d) => (env[k] === undefined || env[k] === '' ? d : Number(env[k]));
const USDC = 1_000_000;
const SOL = 1_000_000_000;
const paper = env.LIVE !== '1';

export const cfg = Object.freeze({
  paper,
  dbPath: env.DB_PATH || (paper ? './data/slab.paper.db' : './data/slab.db'),
  port: num('PORT', 4877),
  rpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  privateKey: env.SLAB_PRIVATE_KEY || '',
  opsWallet: env.OPS_WALLET || '',
  adminToken: env.ADMIN_TOKEN || '',
  ccBase: env.CC_BASE || 'https://api.collectorcrypt.com',
  userAgent: 'slab/0.1 (+https://github.com/kAUZYAbuild/slab)',
  pptBase: 'https://www.pokemonpricetracker.com/api/v2',
  pptKey: env.PPT_KEY || '',
  pptDailyBudget: num('PPT_DAILY_BUDGET', 80),
  usepodBase: 'https://api.usepod.ai/proxy/x402/v1',
  usepodModel: env.USEPOD_MODEL || '',
  llmDailyCapU: num('LLM_DAILY_CAP_U', 2 * USDC),
  llmMaxCallU: num('LLM_MAX_CALL_U', Math.round(0.05 * USDC)),
  clawpumpKey: env.CLAWPUMP_KEY || '',
  clawpumpAgentId: env.CLAWPUMP_AGENT_ID || '',
  tokenMint: env.TOKEN_MINT || '',

  // buy side. USDC micros and lamports everywhere.
  minTicketU: num('MIN_TICKET_U', 20 * USDC),
  maxTicketU: num('MAX_TICKET_U', 150 * USDC),
  minEdge: num('MIN_EDGE', 0.15),
  maxPosPct: 0.25,
  maxOpen: num('MAX_OPEN', 6),
  dailyCapU: num('DAILY_CAP_U', 300 * USDC),
  minCashReserveU: num('MIN_CASH_RESERVE_U', 25 * USDC),
  minSolLamports: Math.round(0.02 * SOL),
  solReserveLamports: Math.round(0.05 * SOL),
  ccFee: 0.02,
  haircut: { 10: 0.92, 9: 0.9, 8: 0.85 },
  nonEnglishPenalty: 0.05,
  promoPenalty: 0.05,
  medPenalty: 0.05,
  floorUndercut: 0.97,

  // sell side
  sellMargin: 1.05,
  repriceDays: 7,
  repriceStep: 0.03,
  stuckDays: 60,
  paperSellDays: 21,
  paperBankrollU: num('PAPER_BANKROLL_U', 500 * USDC),

  hostingU: num('HOSTING_U', 7 * USDC),
  maxTransferU: num('MAX_TRANSFER_U', 10 * USDC),
  tickMs: num('TICK_MS', 60_000),
});

export function preflight() {
  const missing = [];
  if (!cfg.pptKey) missing.push('PPT_KEY (comps; nothing scores without it)');
  if (!cfg.paper) {
    if (!cfg.privateKey) missing.push('SLAB_PRIVATE_KEY');
    if (!cfg.opsWallet) missing.push('OPS_WALLET');
    if (!cfg.adminToken) missing.push('ADMIN_TOKEN');
  }
  return missing;
}

export const usd = (u) => (u / USDC).toFixed(2);
export const sol = (l) => (l / SOL).toFixed(4);
export { USDC, SOL };
