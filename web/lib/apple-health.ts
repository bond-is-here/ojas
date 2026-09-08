import type { SyncedEntry } from './connections.ts';
import { shiftDay, validDay, TYPE_META, type EntryType } from './health.ts';
import { xmlTags, xmlAttributes } from './xml-tags.ts';
type Interval = { start: number; end: number; endDay: string };
export type AppleSource = { name: string; entries: SyncedEntry[] };
export type AppleExport = {
  sources: AppleSource[];
  fromDay: string;
  throughDay: string;
  exportedAt: string;
};
function appleTime(value: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/.exec(
      value,
    );
  return match &&
    validDay(match[1]) &&
    Number(match[2].slice(0, 2)) < 24 &&
    Number(match[2].slice(3, 5)) < 60 &&
    Number(match[2].slice(6)) < 60 &&
    Math.abs(Number(match[3])) <= 14 &&
    Number(match[4]) < 60
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
  let session:
    | { start: number; end: number; endDay: string; duration: number }
    | undefined;
  const finish = () => {
    if (session)
      days.set(
        session.endDay,
        (days.get(session.endDay) || 0) + session.duration / 3600000,
      );
  };
  for (const part of merged) {
    if (
      session &&
      part.start - session.end <= 3 * 3600000 &&
      part.end - session.start <= 24 * 3600000
    ) {
      session.duration += part.end - part.start;
      session.end = part.end;
      session.endDay = part.endDay;
    } else {
      finish();
      session = {
        start: part.start,
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
): Promise<AppleExport> {
  let earliest = shiftDay(today, -29);
  let readFrom = shiftDay(earliest, -2);
  let throughDay = today;
  let exportedAt = '';
  let snapshot = NaN;
  let rootSeen = false;
  let rootClosed = false;
  const stack: string[] = [];
  let totalMatched = 0;
  const devices = new Map<
    string,
    { totals: Map<string, number>; sleep: Interval[]; seen: Set<string> }
  >();
  for await (const tag of xmlTags(chunks)) {
    if (!tag.startsWith('<') || tag.startsWith('<![CDATA[')) {
      if (!rootSeen || rootClosed)
        throw new Error(
          'Choose a complete export.xml without extra content outside HealthData.',
        );
      continue;
    }
    if (tag.startsWith('<?')) {
      if (!tag.endsWith('?>')) throw new Error('Invalid XML declaration.');
      continue;
    }
    if (tag.startsWith('<!DOCTYPE')) {
      if (rootSeen || !/^<!DOCTYPE\s+HealthData\b/.test(tag))
        throw new Error('Choose export.xml from Apple Health.');
      continue;
    }
    const close = /^<\/([\w:.-]+)\s*>$/.exec(tag);
    if (close) {
      if (stack.pop() !== close[1])
        throw new Error(
          'This export is incomplete or has mismatched XML tags.',
        );
      if (close[1] === 'HealthData') rootClosed = true;
      continue;
    }
    const name = /^<([\w:.-]+)(?:\s|\/?>)/.exec(tag)?.[1];
    if (
      !name ||
      rootClosed ||
      (!stack.length && (rootSeen || name !== 'HealthData'))
    )
      throw new Error('Choose a complete export.xml from Apple Health.');
    if (!rootSeen) rootSeen = true;
    const parent = stack.at(-1);
    const a = xmlAttributes(tag);
    if (!/\/\s*>$/.test(tag)) stack.push(name);
    else if (name === 'HealthData') rootClosed = true;
    if (stack.length > 64)
      throw new Error('The XML file contains too many nested elements.');
    if (name === 'ExportDate' && parent === 'HealthData') {
      if (
        exportedAt ||
        !Number.isFinite(appleTime(a.value || '')) ||
        a.value.slice(0, 10) > shiftDay(today, 1) ||
        a.value.slice(0, 10) < shiftDay(today, -90)
      )
        throw new Error('Choose a recent export with a valid ExportDate.');
      snapshot = appleTime(a.value);
      exportedAt = new Date(snapshot).toISOString();
      throughDay = a.value.slice(0, 10);
      earliest = shiftDay(throughDay, -29);
      readFrom = shiftDay(earliest, -2);
    }
    if (name !== 'Record' || parent !== 'HealthData') continue;
    if (!exportedAt)
      throw new Error(
        'This export is missing its ExportDate before the records.',
      );
    const day = a.startDate?.slice(0, 10);
    const endDay = a.endDate?.slice(0, 10);
    let type: EntryType | undefined;
    if (a.type === 'HKQuantityTypeIdentifierStepCount') type = 'activity';
    else if (a.type === 'HKQuantityTypeIdentifierDietaryEnergyConsumed')
      type = 'nutrition';
    else if (a.type === 'HKQuantityTypeIdentifierDietaryWater') type = 'water';
    else if (a.type === 'HKCategoryTypeIdentifierSleepAnalysis') type = 'sleep';
    else continue;
    if (!validDay(day) || !validDay(endDay))
      throw new Error(
        'A health record has an invalid date. Choose a fresh export.',
      );
    if (endDay < readFrom || day > throughDay) continue;
    const begin = appleTime(a.startDate || ''),
      end = appleTime(a.endDate || '');
    if (
      !Number.isFinite(begin) ||
      !Number.isFinite(end) ||
      end < begin ||
      a.type.length > 100 ||
      (a.value?.length || 0) > 100 ||
      (a.unit?.length || 0) > 24 ||
      (a.sourceName?.length || 0) > 100
    )
      throw new Error(
        'A recent health record is invalid. Export your Health data again before importing.',
      );
    if (end > snapshot)
      throw new Error(
        'A health record is newer than this export’s date. Choose a fresh export.',
      );
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
    ) {
      if (
        ![
          '0',
          '2',
          'HKCategoryValueSleepAnalysisInBed',
          'HKCategoryValueSleepAnalysisAwake',
        ].includes(a.value)
      )
        throw new Error(
          'A sleep record has an unsupported state. Your saved history has not changed.',
        );
      continue;
    }
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
      if (end <= begin || end - begin > 24 * 3600000)
        throw new Error(
          'A sleep record has an invalid duration. Your saved history has not changed.',
        );
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
    if (
      !a.value?.trim() ||
      !/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(a.value)
    )
      throw new Error('A recent health record has an invalid quantity.');
    if (!Number.isFinite(amount) || amount < 0)
      throw new Error('A recent health record has an invalid quantity.');
    if (type === 'activity' && a.unit !== 'count')
      throw new Error('This steps record has an unsupported unit.');
    if (type === 'nutrition') {
      if (a.unit === 'kJ') amount /= 4.184;
      else if (a.unit !== 'kcal')
        throw new Error('This food record has an unsupported unit.');
    }
    if (type === 'water') {
      if (a.unit === 'L') amount *= 1000;
      else if (a.unit === 'fl_oz_us') amount *= 29.5735295625;
      else if (a.unit !== 'mL' && a.unit !== 'ml')
        throw new Error('This water record has an unsupported unit.');
    }
    const group = `${type}:${day}`;
    device.totals.set(group, (device.totals.get(group) || 0) + amount);
  }
  if (!rootSeen)
    throw new Error(
      'Choose export.xml from an Apple Health export. ZIP files need to be unzipped first.',
    );
  if (!rootClosed || stack.length || !exportedAt)
    throw new Error(
      'This export is incomplete. Choose the complete export.xml file.',
    );
  const sources: AppleSource[] = [];
  for (const [name, device] of devices) {
    for (const [day, amount] of sleepByDay(device.sleep))
      if (day >= earliest && day <= throughDay)
        device.totals.set(`sleep:${day}`, amount);
    const entries: SyncedEntry[] = [];
    for (const [recordId, value] of device.totals) {
      const [type, ...dateParts] = recordId.split(':');
      const day = dateParts.join(':');
      const t = type as EntryType;
      const amount = t === 'sleep' ? value : Math.round(value);
      if (amount > TYPE_META[t].max)
        throw new Error(
          `A daily ${TYPE_META[t].label.toLowerCase()} total is outside the supported range. Your saved history has not changed.`,
        );
      if (amount <= 0) continue;
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
  return {
    sources: sources.sort((a, b) => b.entries.length - a.entries.length),
    fromDay: earliest,
    throughDay,
    exportedAt,
  };
}
