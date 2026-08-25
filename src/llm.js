// The two things the model is allowed to do: read a listing title the regex
// could not, and write a short status post. Neither touches a trade decision.
import { db, now, counterInc, counterGet } from './db.js';
import { messages, text } from './usepod.js';
import { isComplete } from './cards.js';
import { log } from './log.js';

const TITLE_CAP = 50;
const insPost = db.prepare('INSERT INTO posts (text, context_json, llm_call_id, created_at) VALUES (?, ?, ?, ?)');

export async function parseTitleLLM(itemName, partial) {
  if (counterGet('llm_title') >= TITLE_CAP) return null;
  counterInc('llm_title');
  const res = await messages({
    max_tokens: 200,
    system: 'You read Pokemon trading card listing titles. Reply with one JSON object and nothing else: {"name":string,"set":string,"number":string,"language":"en"|"ja"|"fr"|"de"|"it"|"es"|"pt"|"ko"|"zh","variants":string[],"promo":boolean}. Lowercase name and set. Number as printed, no leading zeros. variants from: holo, reverse foil, full art, 1st edition, shadowless.',
    messages: [{ role: 'user', content: `Title: ${itemName}\nKnown: ${JSON.stringify(partial)}` }],
  }, { purpose: 'title' });
  const raw = text(res);
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const id = { ...partial, ...j, name: String(j.name ?? '').toLowerCase(), set: partial.set || String(j.set ?? '').toLowerCase(), number: String(j.number ?? partial.number ?? '').toUpperCase() };
  return isComplete(id) ? id : null;
}

export async function writePost(context) {
  const res = await messages({
    max_tokens: 160,
    system: 'You write one short status note for an autonomous card-collecting agent, under 240 characters. Plain language, state what happened with numbers, no hype, no exclamation marks, no emojis, no hashtags, no promises about a token. Vary sentence shape.',
    messages: [{ role: 'user', content: JSON.stringify(context) }],
  }, { purpose: 'post' });
  const body = text(res).slice(0, 280);
  if (!body) return null;
  const callId = db.prepare('SELECT id FROM llm_calls ORDER BY id DESC LIMIT 1').get()?.id ?? null;
  insPost.run(body, JSON.stringify(context), callId, now());
  log('post', 'info', body);
  return body;
}
