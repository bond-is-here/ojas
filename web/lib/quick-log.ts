import {
  TYPE_META,
  validAmount,
  type EntryType,
  type Entry,
} from './health.ts';

export type Capture = Pick<Entry, 'type' | 'amount' | 'title'>;
export function parseQuickLog(raw: string): Capture | null {
  const input = raw.trim().toLowerCase().replace(/,/g, '');
  if (!input || input.length > 160) return null;
  const categories = [
    /\b(?:water|ml|milliliters?|liters?|litres?|oz)\b|\d\s*l\b/.test(input),
    /\b(?:sleep|slept|nap)\b/.test(input),
    /\b(?:steps?)\b/.test(input),
    /\b(?:kcal|calories?|cals?)\b/.test(input),
  ];
  if (categories.filter(Boolean).length !== 1) return null;
  const quantityPattern =
    /\d+(?:\.\d+)?\s*(?:ml|milliliters?|l|liters?|litres?|oz|k?\s*steps?|kcal|calories?|cals?)\b/g;
  if (!categories[1] && [...input.matchAll(quantityPattern)].length !== 1)
    return null;
  if (
    categories[1] &&
    ([...input.matchAll(/\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?)\b/g)].length > 1 ||
      [...input.matchAll(/\d+\s*(?:m|min|mins|minutes?)\b/g)].length > 1)
  )
    return null;
  let type: EntryType;
  let amount: number;
  if (categories[0]) {
    type = 'water';
    const m = input.match(
      /(?:^|\s)(\d+(?:\.\d+)?)\s*(ml|milliliters?|l|liters?|litres?|oz)\b/,
    );
    if (!m) return null;
    amount = Math.round(
      Number(m[1]) *
        (/^(l|liter|litre)/.test(m[2]) ? 1000 : m[2] === 'oz' ? 29.5735 : 1),
    );
  } else if (categories[1]) {
    type = 'sleep';
    const h = input.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/);
    const m = input.match(/(?:^|\s)(\d+)\s*(?:m|min|mins|minutes?)\b/);
    if (!h && !m) return null;
    amount = (Number(h?.[1] || 0) * 60 + Number(m?.[1] || 0)) / 60;
  } else if (categories[2]) {
    type = 'activity';
    const m = input.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(k)?\s*steps?\b/);
    if (!m) return null;
    amount = Number(m[1]) * (m[2] ? 1000 : 1);
  } else {
    type = 'nutrition';
    const m = input.match(/(?:^|\s)(\d+)\s*(?:kcal|calories?|cals?)\b/);
    if (!m) return null;
    amount = Number(m[1]);
  }
  if (!validAmount(type, amount)) return null;
  return {
    type,
    amount,
    title: raw.trim().slice(0, 100) || TYPE_META[type].placeholder,
  };
}

export function recentCaptures(entries: Entry[]): Capture[] {
  const seen = new Set<string>();
  return [...entries]
    .filter((e) => !e.sample && !e.source)
    .sort((a, b) => `${b.day}T${b.time}`.localeCompare(`${a.day}T${a.time}`))
    .filter((e) => {
      const key = `${e.type}:${e.amount}:${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map(({ type, amount, title }) => ({ type, amount, title }));
}
