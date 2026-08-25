// One real paid inference call. Needs SLAB_PRIVATE_KEY with a little USDC and
// SOL, and USEPOD_MODEL. Prints the quote, the payment signature, the answer,
// and the ledger entry it produced.
import { messages, text } from '../src/usepod.js';
import { transactions } from '../src/ledger.js';
import { db } from '../src/db.js';

const res = await messages({ max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the single word: slab' }] }, { purpose: 'ping' });
console.log('answer:', text(res), 'usage:', res.usage);
console.log('llm_calls:', db.prepare('SELECT quote_id, quoted_u, paid_u, pay_sig, state FROM llm_calls ORDER BY id DESC LIMIT 1').get());
console.log('ledger:', transactions(1)[0]);
