import {
  authenticatedUser,
  requireSameOrigin,
  readJSON,
  json,
  fail,
  ApiError,
} from '@/server/runtime';
import { getWorkspace, mutateWorkspace } from '@/server/workspace';
import { validDay } from '@/lib/health';

export async function GET(request: Request) {
  try {
    const user = authenticatedUser(request);
    const day =
      new URL(request.url).searchParams.get('day') ||
      new Date().toISOString().slice(0, 10);
    if (!validDay(day)) throw new ApiError('Choose a valid day.');
    return json(await getWorkspace(user, day));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    if (request.headers.get('x-ojas-account') !== user)
      throw new ApiError(
        'Your account changed. Reload Ojas before saving.',
        409,
      );
    return json(await mutateWorkspace(user, await readJSON(request)));
  } catch (error) {
    return fail(error);
  }
}
