// Refreshes test/fixtures/cards.json from live Collector Crypt listings.
import { writeFileSync } from 'node:fs';
import * as cc from '../src/cc.js';

const out = [];
for (let page = 1; page <= 3; page++) {
  const r = await cc.scan({ page, step: 100 });
  for (const c of r.filterNFtCard ?? []) out.push({ itemName: c.itemName, set: c.set, serial: c.serial, year: c.year, grade: c.grade, gradeNum: c.gradeNum, insured: c.insuredValue, price: c.listing?.price, std: c.nftStandard });
}
writeFileSync(new URL('../test/fixtures/cards.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('fixtures', out.length);
