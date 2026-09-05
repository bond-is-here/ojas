import {
  authenticatedUser,
  requireSameOrigin,
  ApiError,
  json,
  fail,
} from '@/server/runtime';
import { isOAuthProvider } from '@/lib/connections';
import { syncProvider } from '@/server/connections';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const user = authenticatedUser(request);
    requireSameOrigin(request);
    const { provider } = await params;
    if (!isOAuthProvider(provider))
      throw new ApiError('Use an export file to update Apple Health.', 400);
    return json(await syncProvider(user, provider));
  } catch (error) {
    return fail(error);
  }
}
