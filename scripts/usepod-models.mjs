// Finds a usable model id for USEPOD_MODEL. Sends a 1-token request per candidate
// and reports which ones quote a price instead of erroring. Costs nothing: it
// stops at the 402 and never pays.
import { cfg } from '../src/config.js';
import { decodeRequired } from '../src/usepod.js';

const candidates = process.argv.slice(2).length ? process.argv.slice(2) : [
  'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5', 'claude-sonnet-5', 'anthropic/claude-haiku-4-5',
  'deepseek-v3.2', 'deepseek/deepseek-v3.2', 'glm-5.1', 'qwen3.5', 'gpt-oss-120b', 'llama-4-maverick',
];
for (const model of candidates) {
  const res = await fetch(cfg.usepodBase + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'User-Agent': cfg.userAgent },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
  });
  const header = res.headers.get('payment-required') ?? res.headers.get('x-payment-required');
  const body = await res.text();
  if (res.status === 402 && header) {
    const q = decodeRequired(header);
    console.log(`OK   ${model}: ceiling ${q.amountU} micro-USDC, asset ${q.asset}, network ${q.network}`);
  } else {
    console.log(`--   ${model}: ${res.status} ${body.slice(0, 140).replace(/\s+/g, ' ')}`);
  }
}
