import {
  authenticatedUser,
  requireSameOrigin,
  readJSON,
  ApiError,
  json,
  fail,
} from '@/server/runtime';
import { object, validateImportedEntries } from '@/lib/connections';
import { importApple } from '@/server/connections';
export async function POST(request: Request) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    const body = object(await readJSON(request, 200000));
    let entries;
    try {
      entries = validateImportedEntries(body.entries);
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : 'Invalid import data.',
      );
    }
    const source =
      typeof body.source === 'string'
        ? body.source.slice(0, 100)
        : 'Apple Health';
    const earliest = new Date(Date.now() - 91 * 86400000)
      .toISOString()
      .slice(0, 10);
    const latest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (entries.some((e) => e.day < earliest || e.day > latest))
      throw new ApiError('Import recent health data from the last 90 days.');
    await importApple(user, entries, source);
    return json({ count: entries.length });
  } catch (error) {
    return fail(error);
  }
}
