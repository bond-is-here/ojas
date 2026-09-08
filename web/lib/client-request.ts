export class ClientRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const unavailable = 'Ojas is temporarily unavailable. Try again shortly.';
const unreadable = 'Ojas returned an unreadable response. Try again.';

function transportError(error: unknown): ClientRequestError {
  if (error instanceof ClientRequestError) return error;
  const name =
    error && typeof error === 'object' && 'name' in error ? error.name : '';
  return new ClientRequestError(
    name === 'TimeoutError' || name === 'AbortError'
      ? 'Ojas took too long to respond. Try again.'
      : 'Could not reach Ojas. Check your connection and try again.',
    0,
  );
}

function serverMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || !('error' in data)) return;
  const value = data.error;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 300 ||
    /[<>\r\n]|(?:Type|Reference|Syntax|Range)Error|SQLITE_|D1_ERROR|\bat .+:\d+/.test(
      value,
    )
  )
    return;
  return value.trim();
}

async function requireSuccess(response: Response) {
  if (response.ok) return;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    // An upstream gateway can return HTML; the HTTP status remains useful.
  }
  throw new ClientRequestError(
    response.status === 401
      ? 'Sign in to Ojas, then try again.'
      : response.status >= 500
        ? unavailable
        : serverMessage(data) ||
          (response.status === 429
            ? 'Too many requests. Wait a moment and try again.'
            : 'This action could not be completed. Try again.'),
    response.status,
  );
}

export async function requestJSON<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
  validator?: (data: unknown) => boolean,
): Promise<T> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await requireSuccess(response);
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ClientRequestError(unreadable, response.status);
      throw error;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new ClientRequestError(unreadable, response.status);
    if (validator && !validator(data))
      throw new ClientRequestError(unreadable, response.status);
    return data as T;
  } catch (error) {
    throw transportError(error);
  }
}

export async function requestExport(accountId: string): Promise<Blob> {
  try {
    const response = await fetch('/api/export', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Ojas-Account': accountId },
      signal: AbortSignal.timeout(60000),
    });
    await requireSuccess(response);
    if (
      !/^application\/x-ndjson(?:;|$)/i.test(
        response.headers.get('content-type') || '',
      )
    )
      throw new ClientRequestError(unreadable, response.status);
    return await response.blob();
  } catch (error) {
    throw transportError(error);
  }
}
