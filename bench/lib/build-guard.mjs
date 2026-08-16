import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_PKG = join(HERE, '..', '..', 'packages', 'vault-rag');

export function devVenvBin() {
  return join(REPO_PKG, '.venv', 'bin');
}

export async function assertBuildUnderTest(endpoint, { allowAny = false, quiet = false } = {}) {
  const health = await fetch(`${endpoint}/health`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  if (!health?.version) {
    if (allowAny) return null;
    throw new Error(
      `the watcher on ${endpoint} did not report a version on /health, so which build is ` +
        'being measured cannot be established. Harnesses here spawn the watcher by name, so ' +
        'PATH picks it, and a watcher older than 0.9.0 cannot say what it is. ' +
        `Fix: PATH="${devVenvBin()}:$PATH" before running, or pass --any-build.`,
    );
  }

  const servingRepo =
    typeof health.module === 'string' && resolve(health.module).startsWith(resolve(REPO_PKG));

  if (!servingRepo && !allowAny) {
    throw new Error(
      `the watcher on ${endpoint} is metalmind-vault-rag ${health.version} loaded from\n` +
        `  ${health.module}\n` +
        'which is not this checkout, because the watcher is spawned by name and PATH chose it.\n' +
        'Results would describe that build, not your working tree. Version alone does not\n' +
        'settle this: an installed copy and this checkout have both read 0.8.0 while holding\n' +
        'different code, so the module directory is what is compared.\n' +
        `Fix: PATH="${devVenvBin()}:$PATH" node <this harness> …\n` +
        'Or pass --any-build if benchmarking an installed release is what you meant.',
    );
  }

  if (!quiet) {
    process.stdout.write(
      `build=${health.version} from ${servingRepo ? 'this checkout' : health.module}\n`,
    );
  }
  return health;
}
