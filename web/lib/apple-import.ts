import {
  object,
  validateImportedEntries,
  type SyncedEntry,
} from './connections.ts';
import { TYPES, shiftDay, validDay, type EntryType } from './health.ts';
import type { AppleExport } from './apple-health.ts';

export type AppleSelection = Partial<Record<EntryType, string>>;
export type AppleImportData = {
  entries: SyncedEntry[];
  source: string;
  fromDay: string;
  throughDay: string;
  exportedAt: string;
  metrics: EntryType[];
};
export function selectAppleImport(
  data: AppleExport,
  selection: AppleSelection,
): AppleImportData {
  const metrics = TYPES.filter(
    (type) => selection[type] && selection[type] !== 'skip',
  );
  const entries = metrics.flatMap((type) => {
    if (selection[type] === 'clear') return [];
    const source = data.sources.find(
      (source) => `device:${source.name}` === selection[type],
    );
    if (!source || !source.entries.some((entry) => entry.type === type))
      throw new Error(
        'Choose a source from this export for each selected metric.',
      );
    return source.entries.filter((entry) => entry.type === type);
  });
  return {
    fromDay: data.fromDay,
    throughDay: data.throughDay,
    exportedAt: data.exportedAt,
    entries,
    metrics,
    source:
      [
        ...new Set(
          metrics
            .map((type) => selection[type])
            .filter((name) => name?.startsWith('device:'))
            .map((name) => name!.slice(7)),
        ),
      ]
        .join(', ')
        .slice(0, 100) || 'Apple Health',
  };
}
export function validateAppleImport(
  input: unknown,
  now = new Date(),
): AppleImportData {
  const body = object(input);
  const { fromDay, throughDay, exportedAt, metrics } = body;
  if (
    !validDay(fromDay) ||
    !validDay(throughDay) ||
    fromDay !== shiftDay(throughDay, -29) ||
    typeof exportedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(exportedAt) ||
    !Number.isFinite(Date.parse(exportedAt)) ||
    new Date(exportedAt).toISOString() !== exportedAt ||
    Date.parse(exportedAt) > now.valueOf() + 5 * 60000 ||
    Date.parse(exportedAt) < now.valueOf() - 91 * 86400000 ||
    Math.abs(Date.parse(`${throughDay}T12:00:00Z`) - Date.parse(exportedAt)) >
      36 * 3600000 ||
    !Array.isArray(metrics) ||
    !metrics.length ||
    metrics.length > 4 ||
    new Set(metrics).size !== metrics.length ||
    metrics.some((type) => !TYPES.includes(type))
  )
    throw new Error(
      'Choose a recent complete Apple Health export and at least one metric.',
    );
  const entries =
    Array.isArray(body.entries) && body.entries.length === 0
      ? []
      : validateImportedEntries(body.entries);
  if (
    entries.some(
      (entry) =>
        entry.day < fromDay ||
        entry.day > throughDay ||
        !metrics.includes(entry.type),
    )
  )
    throw new Error(
      'The import preview does not match its date range and selected metrics.',
    );
  return {
    entries,
    fromDay,
    throughDay,
    exportedAt,
    metrics,
    source:
      typeof body.source === 'string'
        ? body.source.slice(0, 100)
        : 'Apple Health',
  };
}
