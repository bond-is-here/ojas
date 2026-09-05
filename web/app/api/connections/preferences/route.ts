import {
  authenticatedUser,
  requireSameOrigin,
  readJSON,
  database,
  ApiError,
  json,
  fail,
} from '@/server/runtime';
import { validPreferences } from '@/lib/connections';
export async function POST(request: Request) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    const preferences = await readJSON(request);
    if (!validPreferences(preferences))
      throw new ApiError('Choose a valid source for every metric.');
    await database()
      .prepare(
        'INSERT INTO sync_preferences (user_id,preferences) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET preferences=excluded.preferences',
      )
      .bind(user, JSON.stringify(preferences))
      .run();
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
