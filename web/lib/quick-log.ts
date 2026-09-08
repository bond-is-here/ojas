import {
  TYPE_META,
  validAmount,
  type EntryType,
  type Entry,
} from './health.ts';

export type Capture = Pick<Entry, 'type' | 'amount' | 'title'>;
export function parseQuickLog(raw: string): Capture | null {
  let input = raw.trim().toLowerCase();
  if (!input || input.length > 160) return null;
  // Only normalize unambiguous thousands separators, never decimal commas.
  for (const number of input.matchAll(/\d[\d,.]*/g)) {
    if (
      number[0].includes(',') &&
      !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(number[0])
    )
      return null;
  }
  input = input.replace(/,/g, '');
  const quantity =
    /(?<![\w.+-])(\d+(?:\.\d+)?)\s*(ml|milliliters?|l|liters?|litres?|oz|k\s*steps?|steps?|kcal|calories?|cals?|h|hr|hrs|hours?|m|min|mins|minutes?)(?![a-z])/g;
  const amounts = [...input.matchAll(quantity)];
  const remainder = input.replace(quantity, ' ');
  // Do not silently ignore negative, partial, extra, or malformed quantities.
  if (!amounts.length || /\d|(?:^|\s)[+−-](?:\s|$)/.test(remainder))
    return null;
  const unitType = (unit: string): EntryType =>
    /^(?:ml|milliliters?|l|liters?|litres?|oz)$/.test(unit)
      ? 'water'
      : /steps?$/.test(unit)
        ? 'activity'
        : /^(?:kcal|calories?|cals?)$/.test(unit)
          ? 'nutrition'
          : 'sleep';
  const types = amounts.map((m) => unitType(m[2]));
  if (new Set(types).size !== 1) return null;
  const keywords: [RegExp, EntryType][] = [
    [/\bwater\b/, 'water'],
    [/\b(?:sleep|slept|nap)\b/, 'sleep'],
    [/\bsteps?\b/, 'activity'],
    [/\b(?:kcal|calories?|cals?)\b/, 'nutrition'],
  ];
  if (
    keywords.some(
      ([pattern, type]) => pattern.test(remainder) && type !== types[0],
    )
  )
    return null;
  let type: EntryType;
  let amount: number;
  const [first] = amounts;
  if (types[0] !== 'sleep' && amounts.length !== 1) return null;
  if (types[0] === 'water') {
    type = 'water';
    amount = Math.round(
      Number(first[1]) *
        (/^(l|liter|litre)/.test(first[2])
          ? 1000
          : first[2] === 'oz'
            ? 29.5735
            : 1),
    );
  } else if (types[0] === 'sleep') {
    type = 'sleep';
    if (!/\b(?:sleep|slept|nap)\b/.test(input)) return null;
    const hours = amounts.filter((m) => m[2].startsWith('h'));
    const minutes = amounts.filter((m) => m[2].startsWith('m'));
    if (hours.length > 1 || minutes.length > 1) return null;
    const h = hours[0],
      m = minutes[0];
    amount = (Number(h?.[1] || 0) * 60 + Number(m?.[1] || 0)) / 60;
  } else if (types[0] === 'activity') {
    type = 'activity';
    amount = Number(first[1]) * (first[2].startsWith('k') ? 1000 : 1);
  } else {
    type = 'nutrition';
    amount = Number(first[1]);
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
    .filter((e) => !e.sample && !e.source && e.type !== 'water')
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
