import { authenticatedUser, ApiError, siteOrigin } from '@/server/runtime';
import { isOAuthProvider } from '@/lib/connections';
import { completeAuthorization } from '@/server/connections';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  let result = 'failed';
  try {
    if (!isOAuthProvider(provider)) throw new ApiError('Unknown source.', 404);
    const user = authenticatedUser(request);
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    const cookie = request.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`ojas_oauth_${provider}=`))
      ?.split('=')
      .slice(1)
      .join('=');
    if (!state || state.length > 200 || state !== cookie)
      throw new ApiError('Authorization session mismatch.', 403);
    if (url.searchParams.has('error')) result = 'cancelled';
    else {
      const code = url.searchParams.get('code');
      if (!code || code.length > 4000)
        throw new ApiError('No authorization code.');
      await completeAuthorization(user, provider, state, code);
      result = 'connected';
    }
  } catch {
    result = 'failed';
  }
  const location = new URL('/', siteOrigin());
  location.searchParams.set('view', 'connections');
  location.searchParams.set('connection', result);
  return new Response(null, {
    status: 303,
    headers: {
      Location: location.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie': `ojas_oauth_${isOAuthProvider(provider) ? provider : 'invalid'}=; Path=/api/connections/${isOAuthProvider(provider) ? provider : 'invalid'}/callback; HttpOnly; SameSite=Lax; Max-Age=0${siteOrigin().startsWith('https:') ? '; Secure' : ''}`,
    },
  });
}
