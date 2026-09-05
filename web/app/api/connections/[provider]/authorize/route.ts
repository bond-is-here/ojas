import {
  authenticatedUser,
  ApiError,
  fail,
  siteOrigin,
} from '@/server/runtime';
import { isOAuthProvider } from '@/lib/connections';
import { authorize } from '@/server/connections';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const user = authenticatedUser(request);
    const { provider } = await params;
    if (!isOAuthProvider(provider)) throw new ApiError('Unknown source.', 404);
    if (request.headers.get('sec-fetch-site') === 'cross-site')
      throw new ApiError('Start the connection from Ojas.', 403);
    const { url, state } = await authorize(user, provider);
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Set-Cookie': `ojas_oauth_${provider}=${state}; Path=/api/connections/${provider}/callback; HttpOnly; SameSite=Lax; Max-Age=600${siteOrigin().startsWith('https:') ? '; Secure' : ''}`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
