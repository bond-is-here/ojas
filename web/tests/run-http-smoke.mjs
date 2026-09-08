import { cp, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), 'ojas-smoke-'));
// Use the exact Miniflare version installed with the pinned Wrangler package.
const wranglerRequire = createRequire(
  await realpath(join(root, 'node_modules/wrangler/package.json')),
);
const { Miniflare } = wranglerRequire('miniflare');
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://localhost:${port}`;
const config = JSON.parse(
  await readFile(join(root, 'dist/server/wrangler.json'), 'utf8'),
);
const env = {
  ...process.env,
  CI: 'true',
  WRANGLER_SEND_METRICS: 'false',
  OJAS_TEST_URL: origin,
};
async function run(args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Check failed (${code}): ${args.at(-1)}`);
}
let worker;
try {
  const serverRoot = join(root, 'dist/server');
  const assetsRoot = join(directory, 'client');
  await cp(join(root, 'dist/client'), assetsRoot, { recursive: true });
  const modulePaths = (await readdir(serverRoot, { recursive: true }))
    .filter((path) => /\.m?js$/.test(path) && path !== 'index.js')
    .sort();
  // Explicit module contents snapshot the compiled Worker. Miniflare has no
  // dev file watcher or Wrangler proxy that can restart a POST mid-request.
  worker = new Miniflare({
    name: 'ojas-smoke',
    rootPath: directory,
    host: '127.0.0.1',
    port,
    modulesRoot: serverRoot,
    modules: await Promise.all(
      ['index.js', ...modulePaths].map(async (path) => ({
        type: 'ESModule',
        path: join(serverRoot, path),
        contents: await readFile(join(serverRoot, path), 'utf8'),
      })),
    ),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    bindings: {
      SITE_ORIGIN: origin,
      CONNECTIONS_ENCRYPTION_KEY: '1'.repeat(64),
    },
    d1Databases: { DB: 'ojas-smoke' },
    d1Persist: join(directory, 'd1'),
    assets: {
      directory: assetsRoot,
      routerConfig: { has_user_worker: true },
    },
    unsafeDevRegistryPath: '',
  });
  await worker.ready;
  const db = await worker.getD1Database('DB');
  const migrations = (await readdir(join(root, 'drizzle')))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  for (const file of migrations) {
    const sql = await readFile(join(root, 'drizzle', file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
  const response = await fetch(`${origin}/api/connections`, {
    headers: { 'oai-authenticated-user-id': 'ojas-smoke-readiness' },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 200)
    throw new Error(
      `Compiled Worker readiness failed (${response.status}): ${await response.text()}`,
    );
  for (const script of [
    'apple-worker-smoke.mjs',
    'http-smoke.mjs',
    'training-http-smoke.mjs',
    'workspace-http-smoke.mjs',
  ])
    await run([join(root, 'tests', script)]);
} finally {
  try {
    await worker?.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
