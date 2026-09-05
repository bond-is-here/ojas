import {
  DEFAULT_SOURCE_PREFERENCES,
  SOURCE_ORDER,
  isOAuthProvider,
  object,
  validPreferences,
  type SourceId,
  type OAuthProvider,
  type SyncedEntry,
  type SourcePreferences,
  type ConnectionStatus,
} from '../lib/connections.ts';
import { ApiError, database, siteOrigin, seal, unseal, hash } from './runtime';
import {
  exchangeTokens,
  fetchSourceData,
  PROVIDERS,
  type Tokens,
} from './providers';
export type ConnectionRow = {
  user_id: string;
  provider: SourceId;
  client_id: string | null;
  secret_cipher: string | null;
  token_cipher: string | null;
  expires_at: number | null;
  status: ConnectionStatus['status'];
  last_sync: string | null;
  last_error: string | null;
  summary: string | null;
  sync_until: number;
  revision: string;
};
export const callbackUrl = (provider: OAuthProvider) =>
  `${siteOrigin()}/api/connections/${provider}/callback`;
export async function getConnection(user: string, provider: SourceId) {
  return database()
    .prepare('SELECT * FROM connections WHERE user_id = ? AND provider = ?')
    .bind(user, provider)
    .first<ConnectionRow>();
}
export async function getConnections(
  user: string,
  day = new Date().toISOString().slice(0, 10),
) {
  const db = database();
  const results = await db.batch([
    db
      .prepare(
        'SELECT provider,status,last_sync,last_error,summary,client_id FROM connections WHERE user_id = ?',
      )
      .bind(user),
    db
      .prepare(
        'SELECT provider,record_id,day,time,type,amount,title FROM source_entries WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC,time ASC',
      )
      .bind(
        user,
        new Date(Date.parse(`${day}T12:00:00Z`) - 31 * 86400000)
          .toISOString()
          .slice(0, 10),
        day,
      ),
    db
      .prepare('SELECT preferences FROM sync_preferences WHERE user_id = ?')
      .bind(user),
    db
      .prepare(
        'SELECT provider,COUNT(*) AS count FROM source_entries WHERE user_id = ? GROUP BY provider',
      )
      .bind(user),
  ]);
  const rows = results[0].results as unknown as ConnectionRow[];
  const entries = results[1].results.map((raw) => {
    const r = raw as unknown as {
      provider: SourceId;
      record_id: string;
      day: string;
      time: string;
      type: SyncedEntry['type'];
      amount: number;
      title: string;
    };
    return {
      id: `${r.provider}:${r.record_id}`,
      source: r.provider,
      recordId: r.record_id,
      day: r.day,
      time: r.time,
      type: r.type,
      amount: r.amount,
      title: r.title,
    };
  });
  let preferences: SourcePreferences = DEFAULT_SOURCE_PREFERENCES;
  const saved = (results[2].results[0] as { preferences?: unknown } | undefined)
    ?.preferences;
  if (typeof saved === 'string') {
    const parsed: unknown = JSON.parse(saved);
    if (validPreferences(parsed)) preferences = parsed;
  }
  const connections = SOURCE_ORDER.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const count = (
      results[3].results as { provider: string; count: number }[]
    ).find((r) => r.provider === provider)?.count;
    return {
      provider,
      status: row?.status || 'not_connected',
      lastSync: row?.last_sync || null,
      lastError: row?.last_error || null,
      summary: row?.summary
        ? (JSON.parse(row.summary) as Record<string, string | number>)
        : null,
      configured: !!row?.client_id,
      count: typeof count === 'number' ? count : 0,
      ...(isOAuthProvider(provider)
        ? { callbackUrl: callbackUrl(provider) }
        : {}),
    } satisfies ConnectionStatus;
  });
  return { connections, entries, preferences };
}
export async function saveCredentials(
  user: string,
  provider: OAuthProvider,
  input: unknown,
) {
  const body = object(input);
  if (
    typeof body.clientId !== 'string' ||
    !body.clientId.trim() ||
    body.clientId.length > 300 ||
    typeof body.clientSecret !== 'string' ||
    !body.clientSecret.trim() ||
    body.clientSecret.length > 5000
  )
    throw new ApiError(
      'Enter the client ID and client secret from your developer app.',
    );
  const cipher = await seal(
    { secret: body.clientSecret.trim() },
    `${user}:${provider}:client`,
  );
  const revision = crypto.randomUUID();
  await database()
    .prepare(
      "INSERT INTO connections (user_id,provider,client_id,secret_cipher,status,revision) VALUES (?,?,?,?,'configured',?) ON CONFLICT(user_id,provider) DO UPDATE SET client_id=excluded.client_id,secret_cipher=excluded.secret_cipher,token_cipher=NULL,expires_at=NULL,status='configured',last_error=NULL,sync_until=0,revision=excluded.revision",
    )
    .bind(user, provider, body.clientId.trim(), cipher, revision)
    .run();
}
export async function authorize(user: string, provider: OAuthProvider) {
  const row = await getConnection(user, provider);
  if (!row?.client_id || !row.secret_cipher)
    throw new ApiError('Set up your developer app before connecting.', 409);
  const state = crypto.randomUUID() + crypto.randomUUID();
  await database().batch([
    database()
      .prepare(
        'DELETE FROM oauth_states WHERE expires_at < ? OR (user_id = ? AND provider = ?)',
      )
      .bind(Date.now(), user, provider),
    database()
      .prepare(
        'INSERT INTO oauth_states (state_hash,user_id,provider,revision,expires_at) VALUES (?,?,?,?,?)',
      )
      .bind(
        await hash(state),
        user,
        provider,
        row.revision,
        Date.now() + 600000,
      ),
  ]);
  const url = new URL(PROVIDERS[provider].authorize);
  url.search = new URLSearchParams({
    client_id: row.client_id,
    redirect_uri: callbackUrl(provider),
    response_type: 'code',
    scope: PROVIDERS[provider].scope,
    state,
  }).toString();
  return { url: url.href, state };
}
export async function completeAuthorization(
  user: string,
  provider: OAuthProvider,
  state: string,
  code: string,
) {
  const db = database();
  const row = await db
    .prepare(
      'DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND provider = ? AND expires_at > ? RETURNING revision',
    )
    .bind(await hash(state), user, provider, Date.now())
    .first<{ revision: string }>();
  if (!row)
    throw new ApiError(
      'This authorization has expired. Start the connection again.',
      409,
    );
  const connection = await getConnection(user, provider);
  if (
    !connection?.client_id ||
    !connection.secret_cipher ||
    connection.revision !== row.revision
  )
    throw new ApiError(
      'Your app setup changed. Start the connection again.',
      409,
    );
  const { secret } = await unseal<{ secret: string }>(
    connection.secret_cipher,
    `${user}:${provider}:client`,
  );
  const tokens = await exchangeTokens(
    provider,
    { clientId: connection.client_id, secret },
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(provider),
    },
  );
  const cipher = await seal(tokens, `${user}:${provider}:tokens`);
  const result = await db
    .prepare(
      "UPDATE connections SET token_cipher=?,expires_at=?,status='connected',last_error=NULL WHERE user_id=? AND provider=? AND revision=?",
    )
    .bind(cipher, tokens.expiresAt, user, provider, row.revision)
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      'Your app setup changed. Start the connection again.',
      409,
    );
}
function insertEntry(user: string, e: SyncedEntry, revision?: string) {
  const sql =
    'INSERT INTO source_entries (user_id,provider,record_id,day,time,type,amount,title) SELECT ?,?,?,?,?,?,?,? WHERE ' +
    (revision
      ? 'EXISTS (SELECT 1 FROM connections WHERE user_id=? AND provider=? AND revision=?)'
      : '1') +
    ' ON CONFLICT(user_id,provider,record_id) DO UPDATE SET day=excluded.day,time=excluded.time,type=excluded.type,amount=excluded.amount,title=excluded.title';
  return database()
    .prepare(sql)
    .bind(
      user,
      e.source,
      e.recordId,
      e.day,
      e.time,
      e.type,
      e.amount,
      e.title,
      ...(revision ? [user, e.source, revision] : []),
    );
}
export async function syncProvider(user: string, provider: OAuthProvider) {
  const db = database();
  const connection = await getConnection(user, provider);
  if (
    !connection?.token_cipher ||
    !connection.client_id ||
    !connection.secret_cipher
  )
    throw new ApiError('Connect this source before syncing.', 409);
  const acquired = await db
    .prepare(
      'UPDATE connections SET sync_until=? WHERE user_id=? AND provider=? AND sync_until < ? AND revision=?',
    )
    .bind(Date.now() + 120000, user, provider, Date.now(), connection.revision)
    .run();
  if (!acquired.meta.changes)
    throw new ApiError(
      'This source is already syncing. Try again shortly.',
      409,
    );
  try {
    let tokens = await unseal<Tokens>(
      connection.token_cipher,
      `${user}:${provider}:tokens`,
    );
    const credentials = await unseal<{ secret: string }>(
      connection.secret_cipher,
      `${user}:${provider}:client`,
    );
    const refresh = async () => {
      if (!tokens.refreshToken)
        throw new ApiError('Reconnect this source to renew access.', 401);
      tokens = await exchangeTokens(
        provider,
        { clientId: connection.client_id!, secret: credentials.secret },
        {
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          ...(provider === 'whoop' ? { scope: 'offline' } : {}),
        },
        tokens.refreshToken,
      );
      const saved = await db
        .prepare(
          'UPDATE connections SET token_cipher=?,expires_at=? WHERE user_id=? AND provider=? AND revision=?',
        )
        .bind(
          await seal(tokens, `${user}:${provider}:tokens`),
          tokens.expiresAt,
          user,
          provider,
          connection.revision,
        )
        .run();
      if (!saved.meta.changes)
        throw new ApiError(
          'The connection changed during sync. Please reconnect.',
          409,
        );
    };
    if (tokens.expiresAt < Date.now() + 60000) await refresh();
    let data;
    try {
      data = await fetchSourceData(provider, tokens.accessToken);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await refresh();
        data = await fetchSourceData(provider, tokens.accessToken);
      } else throw error;
    }
    const current = await getConnection(user, provider);
    if (current?.revision !== connection.revision)
      throw new ApiError(
        'The connection changed during sync. Please try again.',
        409,
      );
    // One atomic batch ensures failed or partial provider requests never replace good history.
    const results = await db.batch([
      ...data.entries.map((e) => insertEntry(user, e, connection.revision)),
      db
        .prepare(
          "UPDATE connections SET status='connected',last_sync=?,last_error=NULL,summary=?,sync_until=0 WHERE user_id=? AND provider=? AND revision=?",
        )
        .bind(
          new Date().toISOString(),
          JSON.stringify(data.summary),
          user,
          provider,
          connection.revision,
        ),
    ]);
    if (!results[results.length - 1].meta.changes)
      throw new ApiError('The connection changed during sync.', 409);
    return { count: data.entries.length };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : 'Sync could not finish. Your previous data is unchanged.';
    await db
      .prepare(
        "UPDATE connections SET last_error=?,status=CASE WHEN ? THEN 'reconnect' ELSE status END WHERE user_id=? AND provider=? AND revision=?",
      )
      .bind(
        message,
        error instanceof ApiError && [401, 403, 409].includes(error.status) ? 1 : 0,
        user,
        provider,
        connection.revision,
      )
      .run();
    throw error instanceof ApiError ? error : new ApiError(message, 502);
  } finally {
    await db
      .prepare(
        'UPDATE connections SET sync_until=0 WHERE user_id=? AND provider=? AND revision=?',
      )
      .bind(user, provider, connection.revision)
      .run();
  }
}
export async function importApple(
  user: string,
  entries: SyncedEntry[],
  source: string,
) {
  const now = new Date().toISOString();
  const summary = JSON.stringify({ Device: source, Records: entries.length });
  await database().batch([
    ...entries.map((e) => insertEntry(user, e)),
    database()
      .prepare(
        "INSERT INTO connections (user_id,provider,status,last_sync,summary,revision) VALUES (?,'apple-health','imported',?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET status='imported',last_sync=excluded.last_sync,summary=excluded.summary,last_error=NULL",
      )
      .bind(user, now, summary, crypto.randomUUID()),
  ]);
}
export async function disconnect(
  user: string,
  provider: SourceId,
  removeData: boolean,
) {
  const db = database();
  const statements = [
    db
      .prepare(
        "UPDATE connections SET status='not_connected',client_id=NULL,secret_cipher=NULL,token_cipher=NULL,expires_at=NULL,last_error=NULL,sync_until=0,revision=? WHERE user_id=? AND provider=?",
      )
      .bind(crypto.randomUUID(), user, provider),
    db
      .prepare('DELETE FROM oauth_states WHERE user_id=? AND provider=?')
      .bind(user, provider),
  ];
  if (removeData)
    statements.push(
      db
        .prepare('DELETE FROM source_entries WHERE user_id=? AND provider=?')
        .bind(user, provider),
      db
        .prepare(
          'UPDATE connections SET last_sync=NULL,summary=NULL WHERE user_id=? AND provider=?',
        )
        .bind(user, provider),
    );
  await db.batch(statements);
}
