import { log } from '@clack/prompts';
import { analyzeRepo, findRepoRoot } from '../backends/graphify.js';
import { extractText, StdioMcpClient } from '../backends/mcp-client.js';
import { type Config, readConfig, writeConfig } from '../config.js';
import { uninstall } from './uninstall.js';

async function loadConfig(): Promise<Config | null> {
  const cfg = await readConfig();
  if (!cfg) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
  }
  return cfg;
}

// Steel — rename via Serena MCP
export async function renameSymbol(oldName: string, newName: string): Promise<void> {
  if (!oldName || !newName) {
    log.error('Usage: metalmind burn steel <old> <new>');
    process.exitCode = 1;
    return;
  }
  const cfg = await loadConfig();
  if (!cfg) return;
  const client = new StdioMcpClient();
  try {
    await client.start({
      command: 'serena',
      args: ['start-mcp-server', '--context', 'claude-code'],
      env: { SERENA_USAGE_REPORTING: 'false' },
    });
    const res = await client.callTool('rename_symbol', { old_name: oldName, new_name: newName });
    const text = extractText(res);
    process.stdout.write(`${text || `Renamed ${oldName} → ${newName}`}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`burn steel failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

// Zinc — team-debug dispatch (prints the prompt for Claude Code)
export async function burnZinc(bug: string): Promise<void> {
  if (!bug?.trim()) {
    log.error('Usage: metalmind burn zinc "<bug description>"');
    process.exitCode = 1;
    return;
  }
  const payload =
    `/team-debug\n\n` +
    `Bug: ${bug}\n\n` +
    `Context: run this in Claude Code. Multiple adversary agents ` +
    `will form competing hypotheses and converge on the true cause.`;
  log.info('Copy this into Claude Code to spawn a team-debug session:');
  process.stdout.write(`\n${payload}\n\n`);
}

// Tin — verbose toggle
export async function toggleVerbose(state?: boolean): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) return;
  const next = state !== undefined ? state : !cfg.verbose;
  cfg.verbose = next;
  await writeConfig(cfg);
  log.success(`verbose = ${next}`);
}

// Pewter — force rebuild graphify index for current repo
export async function pewterReindex(): Promise<void> {
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    log.error('Not inside a git repository.');
    process.exitCode = 1;
    return;
  }
  log.step(`Re-indexing ${repoRoot} with graphify`);
  try {
    await analyzeRepo(repoRoot);
    log.success('done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`burn pewter failed: ${message}`);
    process.exitCode = 1;
  }
}

// Aluminum — alias to uninstall
export async function aluminumWipe(): Promise<void> {
  await uninstall();
}
