import { env } from 'cloudflare:workers';
import { ApiError } from './errors.ts';
export { ApiError } from './errors.ts';
export function bindings() {
  return env as unknown as {
    DB?: D1Database;
    CONNECTIONS_ENCRYPTION_KEY?: string;
    SITE_ORIGIN?: string;
  };
}
export function database() {
  const db = bindings().DB;
  if (!db)
    throw new ApiError(
      'Your account data is temporarily unavailable. Please try again.',
      503,
    );
  return db;
}
export function siteOrigin() {
  const origin = bindings().SITE_ORIGIN;
  if (!origin)
    throw new ApiError('Connection setup is not available yet.', 503);
  const url = new URL(origin);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost')
    throw new ApiError('Connection setup needs a secure site address.', 503);
  return url.origin;
}
export function authenticatedUser(request: Request) {
  const user = request.headers.get('oai-authenticated-user-id');
  if (!user || user.length > 200)
    throw new ApiError('Sign in to Ojas to continue.', 401);
  const expected = request.headers.get('x-ojas-account');
  if (expected && expected !== user)
    throw new ApiError('Your account changed. Reload Ojas to continue.', 409);
  return user;
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== siteOrigin())
    throw new ApiError('Open this action from your Ojas workspace.', 403);
}
export async function readJSON(
  request: Request,
  maxBytes = 100000,
): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new ApiError('Send a JSON request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError('This request is too large.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ApiError('The request could not be read.');
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export function fail(error: unknown) {
  return json(
    {
      error:
        error instanceof ApiError
          ? error.message
          : 'The request could not be completed. Please try again.',
    },
    error instanceof ApiError ? error.status : 500,
  );
}
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
function bytes(value: string) {
  if (!/^(?:[a-f0-9]{2})+$/.test(value))
    throw new ApiError(
      'Connection credentials need to be configured again.',
      409,
    );
  return Uint8Array.from(value.match(/.{2}/g)!, (h) => parseInt(h, 16));
}
async function key() {
  const raw = bindings().CONNECTIONS_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw))
    throw new ApiError('Secure connection storage is not configured.', 503);
  return crypto.subtle.importKey('raw', bytes(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function seal(value: unknown, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    await key(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${hex(iv)}.${hex(new Uint8Array(encrypted))}`;
}
export async function unseal<T>(value: string, context: string): Promise<T> {
  try {
    const [version, iv, cipher] = value.split('.');
    if (version !== 'v1') throw new Error('Invalid version');
    const raw = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes(iv),
        additionalData: new TextEncoder().encode(context),
      },
      await key(),
      bytes(cipher),
    );
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw error;
    throw new ApiError('Reconnect this source to restore access.', 409);
  }
}
