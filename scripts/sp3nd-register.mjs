// Creates the agent's SP3ND credentials (instant, no approval queue). Prints the
// one-time secret once; put both in .env. Needs SLAB_PRIVATE_KEY and SP3ND_EMAIL.
import { cfg } from '../src/config.js';
import { register } from '../src/sp3nd.js';

if (!cfg.privateKey || !cfg.sp3ndEmail) { console.error('needs SLAB_PRIVATE_KEY and SP3ND_EMAIL'); process.exit(1); }
const out = await register({ agentName: 'slab', email: cfg.sp3ndEmail, description: 'collector agent buying graded cards for a vault' });
console.log('SP3ND_API_KEY=' + out.api_key);
console.log('SP3ND_API_SECRET=' + out.api_secret);
console.log('save the secret now; it is shown once');
