// Pre-renders the site to a static folder: node scripts/build-site.mjs [apiBase] [outDir]
// apiBase is where the live agent answers /api/* and /events (empty = same origin).
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';

const api = process.argv[2] ?? '';
const src = new URL('../site/', import.meta.url).pathname;
const out = (process.argv[3] ?? new URL('../dist/', import.meta.url).pathname).replace(/\/?$/, '/');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const relative = (html, depth) => {
  const up = depth ? '../'.repeat(depth) : './';
  return html
    .replace(/(href|src|poster)="\/(assets\/|style\.css|app\.js|pages\.js|orbit\.js)/g, `$1="${up}$2`)
    .replace(/href="\/(holdings|decisions|ledger|log)"/g, `href="${up}$1/"`)
    .replace(/href="\/#/g, `href="${up}#`)
    .replace(/href="\/"/g, `href="${up}"`)
    .replace(/href="\/(ops|api\/state)"/g, `href="${api}/$1"`)
    .replace('<link rel="stylesheet"', `<meta name="slab-api" content="${api}">\n<link rel="stylesheet"`);
};

writeFileSync(out + 'index.html', relative(readFileSync(src + 'index.html', 'utf8'), 0));
const shell = readFileSync(src + 'shell.html', 'utf8');
for (const page of ['holdings', 'decisions', 'ledger', 'log']) {
  const body = readFileSync(`${src}pages/${page}.html`, 'utf8');
  const title = body.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] ?? page;
  mkdirSync(out + page, { recursive: true });
  writeFileSync(`${out}${page}/index.html`, relative(shell.replaceAll('{{page}}', page).replaceAll('{{title}}', title).replace('{{content}}', body), 1));
}
for (const f of ['style.css', 'app.js', 'pages.js', 'orbit.js']) cpSync(src + f, out + f);
cpSync(src + 'assets', out + 'assets', { recursive: true });
writeFileSync(out + 'README.md', `# slab site\n\nStatic build of the slab monitor. Rebuild from the slab repo with \`node scripts/build-site.mjs <apiBase> <outDir>\`. The pages read live data from \`${api || 'the same origin'}\`.\n`);
console.log('built', out, api ? `api ${api}` : 'same-origin api');
