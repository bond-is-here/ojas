import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(new URL('..', import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), 'ojas-smoke-'));
const cli = join(root, 'node_modules/wrangler/bin/wrangler.js');
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://localhost:${port}`;
const config = JSON.parse(
  await readFile(join(root, 'dist/server/wrangler.json'), 'utf8'),
);
config.main = join(root, 'dist/server/index.js');
config.assets.directory = join(root, 'dist/client');
config.vars = {
  SITE_ORIGIN: origin,
  CONNECTIONS_ENCRYPTION_KEY: '1'.repeat(64),
};
config.d1_databases = [
  {
    binding: 'DB',
    database_name: 'ojas-smoke',
    database_id: '00000000-0000-4000-8000-000000000000',
    migrations_dir: join(root, 'drizzle'),
  },
];
const configPath = join(directory, 'wrangler.json');
await writeFile(configPath, JSON.stringify(config));
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
let worker,
  exited,
  output = '';
try {
  await run([
    cli,
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    configPath,
    '--persist-to',
    join(directory, 'state'),
  ]);
  worker = spawn(
    process.execPath,
    [
      cli,
      'dev',
      '--local',
      '--config',
      configPath,
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      join(directory, 'state'),
    ],
    { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  exited = once(worker, 'exit');
  worker.stdout.on('data', (chunk) => {
    output = (output + chunk).slice(-5000);
  });
  worker.stderr.on('data', (chunk) => {
    output = (output + chunk).slice(-5000);
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${origin}/api/connections`, {
        headers: { 'oai-authenticated-user-id': 'ojas-smoke-readiness' },
        signal: AbortSignal.timeout(1500),
      });
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    if (worker.exitCode !== null) break;
    await delay(500);
  }
  if (!ready) throw new Error(`Compiled Worker did not start.\n${output}`);
  for (const script of [
    'apple-worker-smoke.mjs',
    'http-smoke.mjs',
    'training-http-smoke.mjs',
    'workspace-http-smoke.mjs',
  ])
    await run([join(root, 'tests', script)]);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
  }
  await rm(directory, { recursive: true, force: true });
}
