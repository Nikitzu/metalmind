import { log } from '@clack/prompts';
import { type RunWizardOptions, runWizard } from '../install/wizard.js';

export interface InitCliOptions {
  yes?: boolean;
  vaultPath?: string;
  flavor?: string;
  serena?: boolean;
  noSerena?: boolean;
  graphify?: boolean;
  noGraphify?: boolean;
  teams?: boolean;
  noTeams?: boolean;
  memoryRouting?: string;
  skipDocker?: boolean;
}

function isFlavor(v: string): v is 'scadrial' | 'classic' {
  return v === 'scadrial' || v === 'classic';
}

function isMemoryRouting(v: string): v is 'vault-only' | 'both' {
  return v === 'vault-only' || v === 'both';
}

function resolveBool(affirmative?: boolean, negative?: boolean): boolean | undefined {
  if (negative) return false;
  if (affirmative) return true;
  return undefined;
}

export async function init(cliOpts: InitCliOptions = {}): Promise<void> {
  try {
    const wizardOpts: RunWizardOptions = {};

    if (cliOpts.vaultPath) wizardOpts.vaultPath = cliOpts.vaultPath;
    if (cliOpts.flavor) {
      if (!isFlavor(cliOpts.flavor)) {
        throw new Error(`--flavor must be "scadrial" or "classic"; got "${cliOpts.flavor}"`);
      }
      wizardOpts.flavor = cliOpts.flavor;
    }
    if (cliOpts.memoryRouting) {
      if (!isMemoryRouting(cliOpts.memoryRouting)) {
        throw new Error(
          `--memory-routing must be "vault-only" or "both"; got "${cliOpts.memoryRouting}"`,
        );
      }
      wizardOpts.memoryRouting = cliOpts.memoryRouting;
    }

    const serena = resolveBool(cliOpts.serena, cliOpts.noSerena);
    if (serena !== undefined) wizardOpts.serena = serena;
    const graphify = resolveBool(cliOpts.graphify, cliOpts.noGraphify);
    if (graphify !== undefined) wizardOpts.graphify = graphify;
    const teams = resolveBool(cliOpts.teams, cliOpts.noTeams);
    if (teams !== undefined) wizardOpts.enableTeams = teams;

    if (cliOpts.skipDocker) wizardOpts.skipDocker = true;

    // --yes fills in every remaining prompt with its default.
    if (cliOpts.yes) {
      if (wizardOpts.vaultPath === undefined) {
        wizardOpts.vaultPath = `${process.env.HOME}/Knowledge`;
      }
      wizardOpts.serena ??= true;
      wizardOpts.graphify ??= true;
      wizardOpts.flavor ??= 'scadrial';
      wizardOpts.memoryRouting ??= 'vault-only';
      wizardOpts.enableTeams ??= false;
    }

    await runWizard(wizardOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`init failed: ${message}`);
    process.exitCode = 1;
  }
}
