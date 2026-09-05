import {
  authenticatedUser,
  requireSameOrigin,
  readJSON,
  ApiError,
  json,
  fail,
} from '@/server/runtime';
import { SOURCE_ORDER, object, type SourceId } from '@/lib/connections';
import { disconnect } from '@/server/connections';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    const { provider } = await params;
    if (!SOURCE_ORDER.includes(provider as SourceId))
      throw new ApiError('Unknown source.', 404);
    const body = object(await readJSON(request, 1000));
    await disconnect(user, provider as SourceId, body.removeData === true);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
