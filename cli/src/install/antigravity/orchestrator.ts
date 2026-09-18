import { clearAntigravityAgentsMd, stampAntigravityAgentsMd } from './agents.js';
import { DEFAULT_GEMINI_DIR } from './shared.js';
import {
  copyAntigravitySkills,
  type MetalmindAntigravitySkill,
  removeAntigravitySkills,
} from './skills.js';

export interface InstallAntigravityOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  eodHook?: boolean;
  notifications?: boolean;
  templatesDir?: string;
  geminiDir?: string;
}

export interface InstallAntigravityResult {
  agentsMd: string;
  skills: MetalmindAntigravitySkill[];
}

export async function installAntigravity(
  opts: InstallAntigravityOptions,
): Promise<InstallAntigravityResult> {
  const geminiDir = opts.geminiDir ?? DEFAULT_GEMINI_DIR;
  const agents = await stampAntigravityAgentsMd({ ...opts, geminiDir });
  const skills = await copyAntigravitySkills({ ...opts, geminiDir });
  return { agentsMd: agents.blockAction, skills: skills.copied };
}

export async function uninstallAntigravity(
  opts: { geminiDir?: string } = {},
): Promise<{ agentsMd: boolean; skills: MetalmindAntigravitySkill[] }> {
  const geminiDir = opts.geminiDir ?? DEFAULT_GEMINI_DIR;
  const agentsMd = await clearAntigravityAgentsMd({ geminiDir });
  const skills = await removeAntigravitySkills({ geminiDir });
  return { agentsMd, skills };
}
