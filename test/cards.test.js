import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTitle, fromCard, cardKey, gradeFromString, isComplete } from '../src/cards.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/cards.json', import.meta.url)));

test('grade parses from the grade string', () => {
  assert.equal(gradeFromString('MINT 9'), 9);
  assert.equal(gradeFromString('GEM-MT 10'), 10);
  assert.equal(gradeFromString('NM-MT 8'), 8);
  assert.equal(gradeFromString('VG-EX 4'), 4);
  assert.equal(gradeFromString('NM-MT+ 8.5'), 8.5);
  assert.equal(gradeFromString(null), null);
});

test('japanese holo', () => {
  const id = parseTitle('2000 #200 Misdreavus-Holo PSA 9 Japanese Neo 3 Pokemon');
  assert.deepEqual(id, {
    game: 'pokemon', year: 2000, number: '200', name: 'misdreavus', variants: ['holo'], language: 'ja', promo: false,
    set: 'neo 3', grade: 9, gradingCompany: 'PSA', cert: null,
  });
});

test('full art prefix, english, no trailing Pokemon', () => {
  const id = parseTitle('2022 #TG02 Full Art/Vaporeon PSA 8 Sword & Shield Brilliant Stars');
  assert.equal(id.name, 'vaporeon');
  assert.deepEqual(id.variants, ['full art']);
  assert.equal(id.number, 'TG02');
  assert.equal(id.language, 'en');
  assert.equal(id.set, 'sword shield brilliant stars');
});

test('reverse foil suffix and 1st edition', () => {
  assert.deepEqual(parseTitle('2021 #125 Eevee-Reverse Foil PSA 8 Sword & Shield Evolving Skies Pokemon').variants, ['reverse foil']);
  const first = parseTitle('2015 #019 Magikarp 1st Edition PSA 9 Japanese XY Bandit Ring Pokemon');
  assert.equal(first.name, 'magikarp');
  assert.deepEqual(first.variants, ['1st edition']);
  assert.equal(first.number, '19');
});

test('promo and other languages', () => {
  assert.equal(parseTitle('2019 #310 Eevee PSA 8 Japanese SM Promo Pokemon').promo, true);
  assert.equal(parseTitle('1999 #99 Grass Energie 1st Edition PSA 9 French Pokemon').language, 'fr');
  assert.equal(parseTitle('2025 #11 Umbreon PSA 8 Simplified Chinese CBB2 C-Gem Pack Vol 2').language, 'zh');
});

test('non-PSA companies parse but are labelled', () => {
  assert.equal(parseTitle('2016 #4 Charizard CGC 9.5 XY Evolutions').gradingCompany, 'CGC');
  assert.equal(parseTitle('2016 #4 Charizard Beckett 9 XY Evolutions').gradingCompany, 'BGS');
  assert.equal(parseTitle('random text'), null);
});

test('fromCard prefers structured fields and fills grade from string when gradeNum is null', () => {
  const id = fromCard({
    itemName: '2023 #004 Ponyta PSA 9 Clc-Trading Card Game Classic Charizard & HO-Oh EX Deck',
    set: 'Pokemon Clc-Trading Card Game Classic Charizard & HO-Oh EX Deck', serial: '004', year: 2023,
    grade: 'MINT 9', gradeNum: null, gradingCompany: 'PSA', gradingID: '92099352',
  });
  assert.equal(id.grade, 9);
  assert.equal(id.number, '4');
  assert.equal(id.cert, '92099352');
  assert.equal(id.name, 'ponyta');
  assert.ok(isComplete(id));
  assert.equal(cardKey(id), 'pokemon|clc trading card game classic charizard ho oh ex deck|4|en|psa|9');
});

test('cardKey separates variants and grades', () => {
  const a = parseTitle('2021 #132 Dragapult-Holo PSA 9 Swsh Black Star Promo Pokemon');
  const b = parseTitle('2021 #132 Dragapult PSA 9 Swsh Black Star Promo Pokemon');
  const c = parseTitle('2021 #132 Dragapult-Holo PSA 10 Swsh Black Star Promo Pokemon');
  assert.notEqual(cardKey(a), cardKey(b));
  assert.notEqual(cardKey(a), cardKey(c));
});

test('live fixtures: grade always resolves, name resolves for at least 95%', () => {
  let named = 0, withSet = 0;
  const misses = [];
  for (const f of fixtures) {
    const id = fromCard({ ...f, gradingCompany: 'PSA', gradingID: 'x' });
    assert.equal(typeof id.grade, 'number', f.itemName);
    if (id.set) withSet++;
    if (id.name) named++; else misses.push(f.itemName);
  }
  // language-only sets ("Pokemon French") legitimately resolve to no set and get skipped, not guessed
  assert.ok(withSet / fixtures.length >= 0.98, `set ${withSet}/${fixtures.length}`);
  assert.ok(named / fixtures.length >= 0.95, `named ${named}/${fixtures.length}; misses: ${misses.slice(0, 10).join(' | ')}`);
});
