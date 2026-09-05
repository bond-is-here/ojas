import {
  authenticatedUser,
  requireSameOrigin,
  readJSON,
  ApiError,
  json,
  fail,
} from '@/server/runtime';
import { isOAuthProvider } from '@/lib/connections';
import { saveCredentials } from '@/server/connections';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    const { provider } = await params;
    if (!isOAuthProvider(provider))
      throw new ApiError('This source does not use app credentials.', 404);
    await saveCredentials(user, provider, await readJSON(request, 12000));
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
