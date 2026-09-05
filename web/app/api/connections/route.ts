import { validDay } from '@/lib/health';
import { authenticatedUser, ApiError, json, fail } from '@/server/runtime';
import { getConnections } from '@/server/connections';
export async function GET(request: Request) {
  try {
    const day = new URL(request.url).searchParams.get('day') || undefined;
    if (day !== undefined && !validDay(day))
      throw new ApiError('Choose a valid date.');
    return json(await getConnections(authenticatedUser(request), day));
  } catch (error) {
    return fail(error);
  }
}
