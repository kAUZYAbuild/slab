// Card identity from Collector Crypt fields. Structured fields (set, serial,
// year, grade, gradingCompany, gradingID) are reliable; itemName carries the
// name, variant and language. Pure functions, no IO.

const LANGS = [
  ['simplified chinese', 'zh'], ['traditional chinese', 'zh'], ['chinese', 'zh'], ['japanese', 'ja'], ['korean', 'ko'],
  ['french', 'fr'], ['german', 'de'], ['italian', 'it'], ['spanish', 'es'], ['portuguese', 'pt'], ['dutch', 'nl'],
  ['russian', 'ru'], ['thai', 'th'], ['indonesian', 'id'], ['polish', 'pl'],
];
const COMPANIES = ['PSA', 'CGC', 'BGS', 'Beckett', 'SGC', 'TAG', 'ACE', 'CSG'];
const TITLE = new RegExp(`^(\\d{4})\\s+#(\\S+)\\s+(.+?)\\s+(${COMPANIES.join('|')})\\s+(10|[1-9](?:\\.5)?)\\s+(.*?)(?:\\s+Pokemon)?$`, 'i');
const PREFIX = /^(Full Art|Secret Rare|Rainbow Rare|Hyper Rare|Ultra Rare|Illustration Rare|Special Illustration Rare|Gold|Shadowless|Reverse Holo|Alt Art|Art Rare)\/(.+)$/i;
const SUFFIX = /^(.+?)-(Holo|Reverse Foil|Reverse Holo|Non-Holo|Holofoil|Cracked Ice|Cosmos Holo|Staff|Prerelease)$/i;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normNumber = (n) => {
  const s = String(n).trim().toUpperCase();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

export function gradeFromString(grade) {
  const m = /(10|[1-9](?:\.5)?)\s*$/.exec(String(grade ?? '').trim());
  return m ? Number(m[1]) : null;
}

function splitLanguage(setText) {
  const lower = setText.toLowerCase();
  for (const [word, code] of LANGS) {
    if (lower.startsWith(word + ' ') || lower === word) return { language: code, set: setText.slice(word.length).trim() };
    if (lower.endsWith(' ' + word)) return { language: code, set: setText.slice(0, -word.length).trim() };
  }
  return { language: 'en', set: setText };
}

export function cleanSet(rawSet) {
  let s = String(rawSet ?? '').trim().replace(/^Pokemon\s+/i, '');
  const { language, set } = splitLanguage(s);
  return { language, set: slug(set), promo: /\bpromo\b/i.test(set) };
}

export function parseName(rawName) {
  let name = rawName.trim();
  const variants = [];
  const p = PREFIX.exec(name);
  if (p) { variants.push(slug(p[1])); name = p[2]; }
  const s = SUFFIX.exec(name);
  if (s) { name = s[1]; variants.push(slug(s[2])); }
  if (/\b1st Edition\b/i.test(name)) { variants.push('1st edition'); name = name.replace(/\s*\b1st Edition\b/i, ''); }
  if (/\bShadowless\b/i.test(name)) { variants.push('shadowless'); name = name.replace(/\s*\bShadowless\b/i, ''); }
  return { name: slug(name), variants: variants.sort() };
}

export function parseTitle(itemName) {
  const m = TITLE.exec(String(itemName ?? '').trim());
  if (!m) return null;
  const [, year, number, rawName, company, grade, rawSet] = m;
  const { name, variants } = parseName(rawName);
  const { language, set, promo } = cleanSet(rawSet);
  return {
    game: 'pokemon', year: Number(year), number: normNumber(number), name, variants, language, promo,
    set, grade: Number(grade), gradingCompany: company.toUpperCase() === 'BECKETT' ? 'BGS' : company.toUpperCase(), cert: null,
  };
}

export function fromCard(card) {
  const title = parseTitle(card.itemName);
  const { language, set, promo } = cleanSet(card.set || title?.set || '');
  const grade = card.gradeNum ?? gradeFromString(card.grade) ?? title?.grade ?? null;
  const company = (card.gradingCompany || title?.gradingCompany || '').toUpperCase() || null;
  return {
    game: 'pokemon',
    year: card.year ?? title?.year ?? null,
    number: card.serial ? normNumber(card.serial) : title?.number ?? null,
    name: title?.name ?? null,
    variants: title?.variants ?? [],
    language: card.set ? language : title?.language ?? 'en',
    promo: card.set ? promo : title?.promo ?? false,
    set: card.set ? set : title?.set ?? null,
    grade,
    gradingCompany: company,
    cert: card.gradingID ?? null,
  };
}

export function cardKey(id) {
  const v = id.variants?.length ? '|' + id.variants.join('+') : '';
  return `${id.game}|${id.set}|${id.number}${v}|${id.language}|${(id.gradingCompany || '').toLowerCase()}|${id.grade}`;
}

export const isComplete = (id) => Boolean(id && id.set && id.number && id.name && id.grade && id.gradingCompany);
