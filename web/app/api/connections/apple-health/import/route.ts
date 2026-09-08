import {
  authenticatedUser,
  requireSameOrigin,
  readJSON,
  ApiError,
  json,
  fail,
} from '@/server/runtime';
import { validateAppleImport } from '@/lib/apple-import';
import { importApple } from '@/server/connections';
export async function POST(request: Request) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    const body = await readJSON(request, 200000);
    let data;
    try {
      data = validateAppleImport(body);
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : 'Invalid import data.',
      );
    }
    await importApple(user, data);
    return json({ count: data.entries.length });
  } catch (error) {
    return fail(error);
  }
}
