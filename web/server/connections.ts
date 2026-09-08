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
import {
  ApiError,
  bindings,
  database,
  siteOrigin,
  seal,
  unseal,
  hash,
} from './runtime';
import {
  exchangeTokens,
  fetchSourceData,
  PROVIDERS,
  type Tokens,
} from './providers';
import { createProviderBudgetRequester } from './provider-budget';
import type { AppleImportData } from '../lib/apple-import.ts';
export type ConnectionRow = {
  user_id: string;
  provider: SourceId;
  client_id: string | null;
  credential_source: 'personal' | 'managed';
  secret_cipher: string | null;
  token_cipher: string | null;
  expires_at: number | null;
  status: ConnectionStatus['status'];
  last_sync: string | null;
  last_error: string | null;
  summary: string | null;
  sync_until: number;
  next_sync_at: number;
  revision: string;
};
export const callbackUrl = (provider: OAuthProvider) =>
  `${siteOrigin()}/api/connections/${provider}/callback`;
type CredentialSource = 'personal' | 'managed';
function managedCredentials(provider: OAuthProvider) {
  const env = bindings();
  const clientId = (
    provider === 'whoop' ? env.WHOOP_CLIENT_ID : env.OURA_CLIENT_ID
  )?.trim();
  const secret = (
    provider === 'whoop' ? env.WHOOP_CLIENT_SECRET : env.OURA_CLIENT_SECRET
  )?.trim();
  return clientId && clientId.length <= 300 && secret && secret.length <= 5000
    ? { clientId, secret }
    : null;
}
async function resolveCredentials(
  user: string,
  provider: OAuthProvider,
  source: CredentialSource,
  clientId: string,
  connection: ConnectionRow,
) {
  if (source === 'managed') {
    const credentials = managedCredentials(provider);
    if (!credentials)
      throw new ApiError(
        'This wearable connection is temporarily unavailable. Please try again later.',
        503,
      );
    if (credentials.clientId !== clientId)
      throw new ApiError(
        'The Ojas connection has changed. Reconnect this wearable to continue.',
        409,
      );
    return credentials;
  }
  if (
    connection.credential_source === 'managed' ||
    connection.client_id !== clientId ||
    !connection.secret_cipher
  )
    throw new ApiError(
      'Your app setup changed. Start the connection again.',
      409,
    );
  const { secret } = await unseal<{ secret: string }>(
    connection.secret_cipher,
    `${user}:${provider}:client`,
  );
  return { clientId, secret };
}
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
        'SELECT provider,status,last_sync,next_sync_at,last_error,summary,client_id,secret_cipher,credential_source FROM connections WHERE user_id = ?',
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
    db
      .prepare(
        'SELECT provider,COUNT(*) AS count FROM source_workouts WHERE user_id=? GROUP BY provider',
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
    const managed = isOAuthProvider(provider)
      ? managedCredentials(provider)
      : null;
    const source: CredentialSource | null = row?.client_id
      ? row.credential_source === 'managed'
        ? 'managed'
        : 'personal'
      : null;
    const count = (
      results[3].results as { provider: string; count: number }[]
    ).find((r) => r.provider === provider)?.count;
    return {
      provider,
      status: row?.status || 'not_connected',
      lastSync: row?.last_sync || null,
      nextSyncAt: row?.next_sync_at || 0,
      lastError: row?.last_error || null,
      summary: row?.summary
        ? (JSON.parse(row.summary) as Record<string, string | number>)
        : null,
      configured:
        source === 'personal'
          ? !!row?.secret_cipher
          : source === 'managed' && managed?.clientId === row?.client_id,
      count:
        (typeof count === 'number' ? count : 0) +
        ((results[4].results as { provider: string; count: number }[]).find(
          (r) => r.provider === provider,
        )?.count || 0),
      ...(isOAuthProvider(provider)
        ? {
            callbackUrl: callbackUrl(provider),
            managedAvailable: !!managed,
            credentialSource: source,
          }
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
      "INSERT INTO connections (user_id,provider,client_id,secret_cipher,status,revision,credential_source) VALUES (?,?,?,?,'configured',?,'personal') ON CONFLICT(user_id,provider) DO UPDATE SET client_id=excluded.client_id,secret_cipher=excluded.secret_cipher,credential_source='personal',token_cipher=NULL,expires_at=NULL,status='configured',last_error=NULL,sync_until=0,revision=excluded.revision",
    )
    .bind(user, provider, body.clientId.trim(), cipher, revision)
    .run();
}
export async function authorize(user: string, provider: OAuthProvider) {
  let row = await getConnection(user, provider);
  if (!row) {
    if (!managedCredentials(provider))
      throw new ApiError(
        'This wearable connection is temporarily unavailable. Please try again later.',
        503,
      );
    await database()
      .prepare(
        "INSERT INTO connections(user_id,provider,status,revision) VALUES (?,?,'not_connected',?) ON CONFLICT(user_id,provider) DO NOTHING",
      )
      .bind(user, provider, crypto.randomUUID())
      .run();
    row = await getConnection(user, provider);
  }
  if (!row)
    throw new ApiError('Your connection could not be started. Try again.', 503);
  const source: CredentialSource =
    row.credential_source !== 'managed' && row.client_id && row.secret_cipher
      ? 'personal'
      : 'managed';
  const clientId =
    source === 'personal'
      ? row.client_id!
      : managedCredentials(provider)?.clientId;
  if (!clientId)
    throw new ApiError(
      'This wearable connection is temporarily unavailable. Please try again later.',
      503,
    );
  const state = crypto.randomUUID() + crypto.randomUUID();
  const results = await database().batch([
    database()
      .prepare(
        'DELETE FROM oauth_states WHERE expires_at < ? OR (user_id = ? AND provider = ? AND EXISTS(SELECT 1 FROM connections WHERE user_id=? AND provider=? AND revision=?))',
      )
      .bind(Date.now(), user, provider, user, provider, row.revision),
    database()
      .prepare(
        'INSERT INTO oauth_states (state_hash,user_id,provider,revision,expires_at,client_id,credential_source) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connections WHERE user_id=? AND provider=? AND revision=?)',
      )
      .bind(
        await hash(state),
        user,
        provider,
        row.revision,
        Date.now() + 600000,
        clientId,
        source,
        user,
        provider,
        row.revision,
      ),
  ]);
  if (!results[1].meta.changes)
    throw new ApiError(
      'Your app setup changed. Start the connection again.',
      409,
    );
  const url = new URL(PROVIDERS[provider].authorize);
  url.search = new URLSearchParams({
    client_id: clientId,
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
  const requester = createProviderBudgetRequester(db);
  const row = await db
    .prepare(
      'DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND provider = ? AND expires_at > ? RETURNING revision,client_id,credential_source',
    )
    .bind(await hash(state), user, provider, Date.now())
    .first<{
      revision: string;
      client_id: string | null;
      credential_source: CredentialSource | null;
    }>();
  if (!row)
    throw new ApiError(
      'This authorization has expired. Start the connection again.',
      409,
    );
  const connection = await getConnection(user, provider);
  if (!connection || connection.revision !== row.revision)
    throw new ApiError(
      'Your app setup changed. Start the connection again.',
      409,
    );
  // Nullable state fields support consent started before this additive migration.
  const source =
    row.credential_source || connection.credential_source || 'personal';
  const clientId = row.client_id || connection.client_id;
  if (!clientId)
    throw new ApiError(
      'Your app setup changed. Start the connection again.',
      409,
    );
  const credentials = await resolveCredentials(
    user,
    provider,
    source,
    clientId,
    connection,
  );
  const tokens = await exchangeTokens(
    provider,
    credentials,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(provider),
    },
    undefined,
    requester,
  );
  const cipher = await seal(tokens, `${user}:${provider}:tokens`);
  const result = await db
    .prepare(
      "UPDATE connections SET token_cipher=?,expires_at=?,status='connected',last_error=NULL,revision=?,sync_until=0,client_id=?,credential_source=?,secret_cipher=CASE WHEN ?='managed' THEN NULL ELSE secret_cipher END WHERE user_id=? AND provider=? AND revision=?",
    )
    .bind(
      cipher,
      tokens.expiresAt,
      crypto.randomUUID(),
      clientId,
      source,
      source,
      user,
      provider,
      row.revision,
    )
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      'Your app setup changed. Start the connection again.',
      409,
    );
}
function insertEntry(user: string, e: SyncedEntry, connection?: ConnectionRow) {
  const sql =
    'INSERT INTO source_entries (user_id,provider,record_id,day,time,type,amount,title) SELECT ?,?,?,?,?,?,?,? WHERE ' +
    (connection
      ? 'EXISTS (SELECT 1 FROM connections WHERE user_id=? AND provider=? AND revision=? AND sync_until=?)'
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
      ...(connection
        ? [user, e.source, connection.revision, connection.sync_until]
        : []),
    );
}
export async function syncProvider(user: string, provider: OAuthProvider) {
  const db = database();
  const requester = createProviderBudgetRequester(db);
  const existing = await getConnection(user, provider);
  if (
    !existing?.token_cipher ||
    !existing.client_id ||
    (existing.credential_source !== 'managed' && !existing.secret_cipher)
  )
    throw new ApiError('Connect this source before syncing.', 409);
  const now = Date.now();
  const connection = await db
    .prepare(
      'UPDATE connections SET sync_until=?,next_sync_at=? WHERE user_id=? AND provider=? AND sync_until<=? AND next_sync_at<=? AND revision=? RETURNING *',
    )
    .bind(
      now + 120000,
      now + 60000,
      user,
      provider,
      now,
      now,
      existing.revision,
    )
    .first<ConnectionRow>();
  if (!connection) {
    const current = await getConnection(user, provider);
    if (!current || current.revision !== existing.revision)
      throw new ApiError(
        'The connection changed. Reload Ojas and try syncing again.',
        409,
      );
    if (current.sync_until > now)
      throw new ApiError(
        'This source is already syncing. Try again shortly.',
        409,
      );
    if (current.next_sync_at > now) {
      const seconds = Math.ceil((current.next_sync_at - now) / 1000);
      throw new ApiError(
        `Wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before syncing this source again.`,
        429,
      );
    }
    throw new ApiError('The connection changed. Try syncing again.', 409);
  }
  try {
    let tokens = await unseal<Tokens>(
      connection.token_cipher!,
      `${user}:${provider}:tokens`,
    );
    const credentials = await resolveCredentials(
      user,
      provider,
      connection.credential_source || 'personal',
      connection.client_id!,
      connection,
    );
    const refresh = async () => {
      if (!tokens.refreshToken)
        throw new ApiError('Reconnect this source to renew access.', 401);
      tokens = await exchangeTokens(
        provider,
        credentials,
        {
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          ...(provider === 'whoop' ? { scope: 'offline' } : {}),
        },
        tokens.refreshToken,
        requester,
      );
      const saved = await db
        .prepare(
          'UPDATE connections SET token_cipher=?,expires_at=? WHERE user_id=? AND provider=? AND revision=? AND sync_until=?',
        )
        .bind(
          await seal(tokens, `${user}:${provider}:tokens`),
          tokens.expiresAt,
          user,
          provider,
          connection.revision,
          connection.sync_until,
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
      data = await fetchSourceData(provider, tokens.accessToken, {
        clientId: connection.client_id!,
        requester,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await refresh();
        data = await fetchSourceData(provider, tokens.accessToken, {
          clientId: connection.client_id!,
          requester,
        });
      } else throw error;
    }
    const current = await getConnection(user, provider);
    if (
      current?.revision !== connection.revision ||
      current.sync_until !== connection.sync_until
    )
      throw new ApiError(
        'The connection changed during sync. Please try again.',
        409,
      );
    // One atomic batch ensures failed or partial provider requests never replace good history.
    const results = await db.batch([
      ...(data.entriesComplete
        ? [
            db
              .prepare(
                'DELETE FROM source_entries WHERE user_id=? AND provider=? AND day>=? AND day<? AND EXISTS(SELECT 1 FROM connections WHERE user_id=? AND provider=? AND revision=? AND sync_until=?)',
              )
              .bind(
                user,
                provider,
                data.window.fromDay,
                data.window.untilDay,
                user,
                provider,
                connection.revision,
                connection.sync_until,
              ),
          ]
        : []),
      ...(data.workoutsComplete
        ? [
            db
              .prepare(
                'DELETE FROM source_workouts WHERE user_id=? AND provider=? AND ' +
                  (provider === 'whoop'
                    ? "json_extract(payload,'$.startedAt')>=? AND json_extract(payload,'$.endedAt')<?"
                    : 'day>=? AND day<?') +
                  ' AND EXISTS(SELECT 1 FROM connections WHERE user_id=? AND provider=? AND revision=? AND sync_until=?)',
              )
              .bind(
                user,
                provider,
                provider === 'whoop' ? data.window.start : data.window.fromDay,
                provider === 'whoop' ? data.window.end : data.window.untilDay,
                user,
                provider,
                connection.revision,
                connection.sync_until,
              ),
          ]
        : []),
      ...data.entries.map((e) => insertEntry(user, e, connection)),
      ...data.workouts.map((w) =>
        db
          .prepare(
            'INSERT INTO source_workouts(user_id,provider,id,day,payload) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connections WHERE user_id=? AND provider=? AND revision=? AND sync_until=?) ON CONFLICT(user_id,provider,id) DO UPDATE SET day=excluded.day,payload=excluded.payload',
          )
          .bind(
            user,
            provider,
            w.id,
            w.day,
            JSON.stringify(w),
            user,
            provider,
            connection.revision,
            connection.sync_until,
          ),
      ),
      db
        .prepare(
          "UPDATE connections SET status='connected',last_sync=?,last_error=NULL,summary=? WHERE user_id=? AND provider=? AND revision=? AND sync_until=?",
        )
        .bind(
          new Date().toISOString(),
          JSON.stringify(data.summary),
          user,
          provider,
          connection.revision,
          connection.sync_until,
        ),
    ]);
    if (!results[results.length - 1].meta.changes)
      throw new ApiError('The connection changed during sync.', 409);
    return { count: data.entries.length + data.workouts.length };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : 'Sync could not finish. Your previous data is unchanged.';
    await db
      .prepare(
        "UPDATE connections SET last_error=?,status=CASE WHEN ? THEN 'reconnect' ELSE status END WHERE user_id=? AND provider=? AND revision=? AND sync_until=?",
      )
      .bind(
        message,
        error instanceof ApiError && [401, 403, 409].includes(error.status)
          ? 1
          : 0,
        user,
        provider,
        connection.revision,
        connection.sync_until,
      )
      .run();
    throw error instanceof ApiError ? error : new ApiError(message, 502);
  } finally {
    await db
      .prepare(
        'UPDATE connections SET sync_until=0 WHERE user_id=? AND provider=? AND revision=? AND sync_until=?',
      )
      .bind(user, provider, connection.revision, connection.sync_until)
      .run();
  }
}
export async function importApple(user: string, data: AppleImportData) {
  const { entries, source, fromDay, throughDay, exportedAt, metrics } = data;
  const db = database();
  const guard = `NOT EXISTS(SELECT 1 FROM apple_import_snapshots WHERE user_id=? AND type IN (${metrics.map(() => '?').join(',')}) AND exported_at>?)`;
  const args = [user, ...metrics, exportedAt];
  const now = new Date().toISOString();
  const summary = JSON.stringify({ Device: source, Records: entries.length });
  const statements = [
    ...metrics.map((type) =>
      db
        .prepare(
          `DELETE FROM source_entries WHERE user_id=? AND provider='apple-health' AND type=? AND day>=? AND day<=? AND ${guard}`,
        )
        .bind(user, type, fromDay, throughDay, ...args),
    ),
    ...entries.map((e) =>
      db
        .prepare(
          `INSERT INTO source_entries(user_id,provider,record_id,day,time,type,amount,title) SELECT ?,'apple-health',?,?,?,?,?,? WHERE ${guard} ON CONFLICT(user_id,provider,record_id) DO UPDATE SET day=excluded.day,time=excluded.time,type=excluded.type,amount=excluded.amount,title=excluded.title`,
        )
        .bind(
          user,
          e.recordId,
          e.day,
          e.time,
          e.type,
          e.amount,
          e.title,
          ...args,
        ),
    ),
    db
      .prepare(
        `INSERT INTO connections (user_id,provider,status,last_sync,summary,revision) SELECT ?,'apple-health','imported',?,?,? WHERE ${guard} ON CONFLICT(user_id,provider) DO UPDATE SET status='imported',last_sync=excluded.last_sync,summary=excluded.summary,last_error=NULL`,
      )
      .bind(user, now, summary, crypto.randomUUID(), ...args),
  ];
  const connectionIndex = statements.length - 1;
  statements.push(
    ...metrics.map((type) =>
      db
        .prepare(
          `INSERT INTO apple_import_snapshots(user_id,type,exported_at) SELECT ?,?,? WHERE ${guard} ON CONFLICT(user_id,type) DO UPDATE SET exported_at=excluded.exported_at`,
        )
        .bind(user, type, exportedAt, ...args),
    ),
  );
  const result = await db.batch(statements);
  if (!result[connectionIndex].meta.changes)
    throw new ApiError(
      'A newer Apple export is already saved. Choose the latest export to replace these days.',
      409,
    );
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
        "UPDATE connections SET status='not_connected',client_id=NULL,secret_cipher=NULL,credential_source='personal',token_cipher=NULL,expires_at=NULL,last_error=NULL,sync_until=0,revision=? WHERE user_id=? AND provider=?",
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
        .prepare('DELETE FROM source_workouts WHERE user_id=? AND provider=?')
        .bind(user, provider),
      db
        .prepare(
          'UPDATE connections SET last_sync=NULL,summary=NULL WHERE user_id=? AND provider=?',
        )
        .bind(user, provider),
    );
  if (removeData && provider === 'apple-health')
    statements.push(
      db
        .prepare('DELETE FROM apple_import_snapshots WHERE user_id=?')
        .bind(user),
    );
  await db.batch(statements);
}
