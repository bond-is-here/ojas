import type { SyncedEntry } from './connections.ts';
import { shiftDay, validDay, TYPE_META, type EntryType } from './health.ts';
type Interval = { start: number; end: number; endDay: string };
export type AppleSource = { name: string; entries: SyncedEntry[] };
function decode(value: string) {
  return value.replace(
    /&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,
    (match, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return (
        (
          { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<
            string,
            string
          >
        )[entity] || match
      );
    },
  );
}
function attributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    result[match[1]] = decode(match[2] ?? match[3]);
  return result;
}
function appleTime(value: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/.exec(
      value,
    );
  return match
    ? Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`)
    : NaN;
}
export function sleepByDay(intervals: Interval[]): Map<string, number> {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const part of sorted) {
    const last = merged.at(-1);
    if (last && part.start <= last.end) {
      if (part.end > last.end) {
        last.end = part.end;
        last.endDay = part.endDay;
      }
    } else merged.push({ ...part });
  }
  const days = new Map<string, number>();
  let session: { end: number; endDay: string; duration: number } | undefined;
  const finish = () => {
    if (session)
      days.set(
        session.endDay,
        (days.get(session.endDay) || 0) + session.duration / 3600000,
      );
  };
  for (const part of merged) {
    if (session && part.start - session.end <= 3 * 3600000) {
      session.duration += part.end - part.start;
      session.end = part.end;
      session.endDay = part.endDay;
    } else {
      finish();
      session = {
        end: part.end,
        endDay: part.endDay,
        duration: part.end - part.start,
      };
    }
  }
  finish();
  return days;
}
export async function parseAppleHealth(
  chunks: AsyncIterable<string>,
  today: string,
): Promise<AppleSource[]> {
  const earliest = shiftDay(today, -29);
  const readFrom = shiftDay(earliest, -2);
  let carry = '';
  let rootSeen = false;
  let rootClosed = false;
  let totalMatched = 0;
  const devices = new Map<
    string,
    { totals: Map<string, number>; sleep: Interval[]; seen: Set<string> }
  >();
  for await (const chunk of chunks) {
    carry += chunk;
    rootSeen ||= /<HealthData\b/.test(carry);
    rootClosed ||= /<\/HealthData\s*>/.test(carry);
    let start = 0;
    const pattern = /<Record\b([^>]*?)>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(carry)) !== null) {
      start = pattern.lastIndex;
      const a = attributes(match[1]);
      const day = a.startDate?.slice(0, 10);
      const endDay = a.endDate?.slice(0, 10);
      if (
        !validDay(day) ||
        !validDay(endDay) ||
        endDay < readFrom ||
        day > today
      )
        continue;
      let type: EntryType | undefined;
      if (a.type === 'HKQuantityTypeIdentifierStepCount') type = 'activity';
      else if (a.type === 'HKQuantityTypeIdentifierDietaryEnergyConsumed')
        type = 'nutrition';
      else if (a.type === 'HKQuantityTypeIdentifierDietaryWater')
        type = 'water';
      else if (a.type === 'HKCategoryTypeIdentifierSleepAnalysis')
        type = 'sleep';
      else continue;
      if (
        type === 'sleep' &&
        ![
          'HKCategoryValueSleepAnalysisAsleep',
          'HKCategoryValueSleepAnalysisAsleepUnspecified',
          'HKCategoryValueSleepAnalysisAsleepCore',
          'HKCategoryValueSleepAnalysisAsleepDeep',
          'HKCategoryValueSleepAnalysisAsleepREM',
          '1',
          '3',
          '4',
          '5',
        ].includes(a.value)
      )
        continue;
      const source = a.sourceName?.trim().slice(0, 100) || 'Apple Health';
      let device = devices.get(source);
      if (!device) {
        if (devices.size >= 64)
          throw new Error(
            'This export contains too many sources. Use a smaller export.',
          );
        device = { totals: new Map(), sleep: [], seen: new Set() };
        devices.set(source, device);
      }
      const key = [a.type, a.startDate, a.endDate, a.value, a.unit].join('|');
      if (device.seen.has(key)) continue;
      device.seen.add(key);
      totalMatched++;
      if (totalMatched > 250000)
        throw new Error(
          'This export has too many recent records to process. Try a smaller export.',
        );
      if (type === 'sleep') {
        const begin = appleTime(a.startDate),
          end = appleTime(a.endDate);
        if (
          Number.isFinite(begin) &&
          Number.isFinite(end) &&
          end > begin &&
          end - begin <= 24 * 3600000
        )
          device.sleep.push({ start: begin, end, endDay });
        continue;
      }
      if (day < earliest) continue;
      let amount = Number(a.value);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (type === 'activity' && a.unit !== 'count') continue;
      if (type === 'nutrition') {
        if (a.unit === 'kJ') amount /= 4.184;
        else if (a.unit !== 'kcal') continue;
      }
      if (type === 'water') {
        if (a.unit === 'L') amount *= 1000;
        else if (a.unit === 'fl_oz_us') amount *= 29.5735295625;
        else if (a.unit !== 'mL' && a.unit !== 'ml') continue;
      }
      const group = `${type}:${day}`;
      device.totals.set(group, (device.totals.get(group) || 0) + amount);
    }
    // Keep only an unfinished Record tag. The export's other elements are never evaluated.
    carry = carry.slice(start);
    const unfinished = carry.lastIndexOf('<Record');
    carry = unfinished >= 0 ? carry.slice(unfinished) : carry.slice(-16);
    if (carry.length > 1048576)
      throw new Error('The XML file contains an invalid record.');
  }
  if (!rootSeen)
    throw new Error(
      'Choose export.xml from an Apple Health export. ZIP files need to be unzipped first.',
    );
  if (!rootClosed)
    throw new Error(
      'This export is incomplete. Choose the complete export.xml file.',
    );
  const sources: AppleSource[] = [];
  for (const [name, device] of devices) {
    for (const [day, amount] of sleepByDay(device.sleep))
      if (day >= earliest && day <= today)
        device.totals.set(`sleep:${day}`, amount);
    const entries: SyncedEntry[] = [];
    for (const [recordId, value] of device.totals) {
      const [type, ...dateParts] = recordId.split(':');
      const day = dateParts.join(':');
      const t = type as EntryType;
      const amount = t === 'sleep' ? value : Math.round(value);
      if (amount <= 0 || amount > TYPE_META[t].max) continue;
      entries.push({
        id: `apple-health:${recordId}`,
        recordId,
        source: 'apple-health',
        day,
        time: t === 'sleep' ? '08:00' : '23:59',
        type: t,
        amount,
        title: `${name} · ${TYPE_META[t].label}`.slice(0, 100),
      });
    }
    if (entries.length)
      sources.push({
        name,
        entries: entries.sort((a, b) => b.day.localeCompare(a.day)),
      });
  }
  if (!sources.length)
    throw new Error(
      'No supported steps, sleep, food, or water records were found in the last 30 days.',
    );
  return sources.sort((a, b) => b.entries.length - a.entries.length);
}
