// One-command playground: bring up the Docker Typesense, wait for it, seed it
// with the sample posts, then start Vite. Run with `npm run dev`.
//
// Requires Docker. If you don't have Docker (or want the zero-setup offline
// mock), use `npm run dev:mock` instead — that skips Typesense entirely and the
// playground falls back to the in-process mock backend.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const playgroundDir = resolve(here, '..');
const HEALTH_URL = 'http://localhost:8108/health';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: playgroundDir, stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

// 1. Docker must be installed and the daemon reachable.
const dockerOk = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (dockerOk.error || dockerOk.status !== 0) {
  fail(
    'Docker is required for `npm run dev` (it runs a real Typesense).\n' +
      '  • Start Docker and try again, or\n' +
      '  • run `npm run dev:mock` to use the zero-setup offline mock instead.'
  );
}

// 2. Start Typesense.
console.log('▸ Starting Typesense (docker compose up -d) …');
if (run('docker', ['compose', 'up', '-d']) !== 0) {
  fail('`docker compose up -d` failed. Check the Docker logs and try again.');
}

// 3. Wait for health.
console.log('▸ Waiting for Typesense to be healthy …');
const deadline = Date.now() + 60_000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    if (res.ok) { healthy = true; break; }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!healthy) fail('Typesense did not become healthy within 60s. Try `docker compose logs`.');

// 4. Seed (idempotent: drops + recreates). The first run downloads the
//    embedding model, which can take a while.
console.log('▸ Seeding sample posts (first run downloads the embedding model — may take a minute) …');
if (run('node', ['scripts/seed.js']) !== 0) {
  fail('Seeding failed. See the output above.');
}

// 5. Start Vite in the foreground; hand over signal handling to it.
console.log('▸ Starting the playground …\n');
const vite = spawn('npx', ['vite'], { cwd: playgroundDir, stdio: 'inherit' });
vite.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => vite.kill(sig));
}
