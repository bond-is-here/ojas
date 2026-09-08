import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as connectionModel from '../lib/connections.ts';
import { ApiError } from '../server/errors.ts';
import { PROVIDERS } from '../server/providers.ts';

const root = new URL('../', import.meta.url);
// Execute actual application modules with explicit local-only dependencies.
export function loadModule(file, dependencies) {
  const source = fs.readFileSync(new URL(file, root), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: Object.create(null) };
  const resolve = (specifier) => {
    if (!(specifier in dependencies))
      throw new Error(`Unexpected dependency: ${specifier}`);
    return dependencies[specifier];
  };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, {
    filename: file,
  })(resolve, loaded, loaded.exports);
  return loaded.exports;
}
export function serverHarness() {
  const environment = /** @type {Record<string, string | undefined>} */ ({});
  const sealedContexts = /** @type {string[]} */ ([]);
  const sqlite = new DatabaseSync(':memory:');
  for (const file of fs
    .readdirSync(new URL('drizzle/', root))
    .filter((file) => file.endsWith('.sql'))
    .sort())
    sqlite.exec(fs.readFileSync(new URL(`drizzle/${file}`, root), 'utf8'));
  const hooks = { before: async (_query, _args) => {} };
  const db = {
    prepare(query) {
      let args = [];
      const statement = {
        bind(...values) {
          args = values;
          return statement;
        },
        async first() {
          await hooks.before(query, args);
          return sqlite.prepare(query).get(...args) || null;
        },
        async run() {
          await hooks.before(query, args);
          if (/^SELECT\b/i.test(query))
            return {
              results: sqlite.prepare(query).all(...args),
              meta: { changes: 0 },
            };
          const result = sqlite.prepare(query).run(...args);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const provider = {
    data: {
      entries:
        /** @type {import('../lib/connections.ts').SyncedEntry[]} */ ([]),
      workouts:
        /** @type {import('../lib/training.ts').SourceWorkout[]} */ ([]),
      summary: {},
      entriesComplete: true,
      workoutsComplete: true,
      window: {
        start: '2026-08-07T12:00:00.000Z',
        end: '2026-09-07T12:00:00.000Z',
        fromDay: '2026-08-07',
        untilDay: '2026-09-08',
      },
    },
    refreshSubmissions: [],
    validRefresh: 'old',
    beforeRefresh: async () => {},
    beforeFetch: async () => {},
    fetchCalls: 0,
    beforeAuthorization: async () => {},
    exchanges:
      /** @type {Array<{provider: string, credentials: {clientId: string, secret: string}, grant: Record<string, string>}>} */ ([]),
  };
  const providers = {
    PROVIDERS,
    async fetchSourceData() {
      provider.fetchCalls++;
      await provider.beforeFetch();
      return provider.data;
    },
    async exchangeTokens(_provider, _credentials, grant) {
      provider.exchanges.push({
        provider: _provider,
        credentials: { ..._credentials },
        grant: { ...grant },
      });
      if (grant.grant_type === 'authorization_code') {
        await provider.beforeAuthorization();
        return {
          accessToken: 'new-authorization',
          refreshToken: 'new-refresh',
          expiresAt: Date.now() + 3600000,
        };
      }
      provider.refreshSubmissions.push(grant.refresh_token);
      if (grant.refresh_token !== provider.validRefresh)
        throw new ApiError('Refresh token is no longer valid.', 409);
      await provider.beforeRefresh();
      provider.validRefresh = 'rotated';
      return {
        accessToken: 'new-access',
        refreshToken: 'rotated',
        expiresAt: Date.now() + 3600000,
      };
    },
  };
  const runtime = {
    ApiError,
    bindings: () => environment,
    database: () => db,
    siteOrigin: () => 'https://ojas.example',
    seal: async (value, context) => {
      sealedContexts.push(context);
      return JSON.stringify(value);
    },
    unseal: async (value) => JSON.parse(value),
    hash: async (value) => value,
  };
  const reloadApi = () =>
    loadModule('server/connections.ts', {
      '../lib/connections.ts': connectionModel,
      './runtime': runtime,
      './providers': providers,
      './provider-budget': {
        createProviderBudgetRequester: () => async () => Response.json({}),
      },
    });
  const api = reloadApi();
  function expireSyncCooldown(user = 'user', provider = 'oura') {
    sqlite
      .prepare(
        'UPDATE connections SET next_sync_at=0 WHERE user_id=? AND provider=?',
      )
      .run(user, provider);
  }
  function seed(expiresAt, provider = 'oura', user = 'user') {
    sqlite
      .prepare(
        'INSERT INTO connections(user_id,provider,client_id,secret_cipher,token_cipher,expires_at,status,revision) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        user,
        provider,
        'client',
        JSON.stringify({ secret: 'secret' }),
        JSON.stringify({
          accessToken: 'old-access',
          refreshToken: 'old',
          expiresAt,
        }),
        expiresAt,
        'connected',
        'revision-1',
      );
  }
  return {
    sqlite,
    hooks,
    provider,
    api,
    reloadApi,
    expireSyncCooldown,
    seed,
    runtime,
    environment,
    sealedContexts,
  };
}
export function hookHarness() {
  const states = [];
  const react = {
    useState(initial) {
      const index = states.length;
      states.push(initial);
      return [
        initial,
        (next) => {
          states[index] =
            typeof next === 'function' ? next(states[index]) : next;
        },
      ];
    },
    useRef(current) {
      return { current };
    },
    useCallback(callback) {
      return callback;
    },
    useEffect() {},
  };
  return { states, react };
}
