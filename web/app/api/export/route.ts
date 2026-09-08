import { authenticatedUser, ApiError, fail } from '@/server/runtime';
import { accountExport } from '@/server/export';

export async function GET(request: Request) {
  try {
    const user = authenticatedUser(request);
    if (request.headers.get('x-ojas-account') !== user)
      throw new ApiError(
        'Your account changed. Reload Ojas before exporting.',
        409,
      );
    return new Response(accountExport(user), {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': `attachment; filename="ojas-${new Date().toISOString().slice(0, 10)}.jsonl"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return fail(error);
  }
}
