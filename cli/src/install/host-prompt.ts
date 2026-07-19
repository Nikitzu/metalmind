import { isCancel, multiselect } from '@clack/prompts';
import { detectHosts, type HostsDetectionResult, type MetalmindHost } from './hosts.js';

export interface PromptHostsOptions {
  /** Override the detection result (test injection). */
  detection?: HostsDetectionResult;
  /** Hosts to pre-check in the multi-select. Filtered to only include detected. */
  preChecked?: MetalmindHost[];
  /**
   * When true, skip the prompt and return preChecked verbatim (filtered to
   * detected hosts). Used for `--no-prompt` (CI / scripted re-stamps).
   */
  noPrompt?: boolean;
  /**
   * When set, return this exact set verbatim (filtered to detected hosts) and
   * skip the prompt. Used for the explicit `--host claude|codex|both` flag.
   */
  forced?: MetalmindHost[];
  /** Override TTY detection (test injection). Defaults to process.stdin.isTTY. */
  isTTY?: boolean;
}

export interface PromptHostsResult {
  /** Final chosen hosts (always a subset of detected). */
  hosts: MetalmindHost[];
  /** True if the user pressed Ctrl-C / cancelled the prompt. */
  cancelled: boolean;
}

const HOST_LABELS: Record<MetalmindHost, string> = {
  claude: 'Claude Code (~/.claude)',
  codex: 'Codex CLI (~/.codex)',
  cursor: 'Cursor (~/.cursor)',
};

const HOST_ORDER: readonly MetalmindHost[] = ['claude', 'codex', 'cursor'];

function intersect(
  candidate: MetalmindHost[] | undefined,
  detected: MetalmindHost[],
): MetalmindHost[] {
  if (!candidate) return detected;
  return candidate.filter((h) => detected.includes(h));
}

export async function promptHosts(opts: PromptHostsOptions = {}): Promise<PromptHostsResult> {
  const detection = opts.detection ?? detectHosts();
  const detected = HOST_ORDER.filter((h) => detection[h]);

  if (detected.length === 0) {
    return { hosts: [], cancelled: false };
  }

  if (opts.forced) {
    return { hosts: intersect(opts.forced, detected), cancelled: false };
  }

  // Headless (CI, agent, piped stdin): clack's multiselect dies with
  // uv_tty_init EINVAL — fall back to the previously-chosen set instead.
  const isTTY = opts.isTTY ?? process.stdin.isTTY === true;
  if (opts.noPrompt || !isTTY) {
    return { hosts: intersect(opts.preChecked, detected), cancelled: false };
  }

  const initial = intersect(opts.preChecked, detected);
  const result = await multiselect({
    message: 'Stamp metalmind into which hosts?',
    options: detected.map((h) => ({ value: h, label: HOST_LABELS[h] })),
    initialValues: initial.length > 0 ? initial : detected,
    required: false,
  });

  if (isCancel(result)) return { hosts: [], cancelled: true };
  return { hosts: result as MetalmindHost[], cancelled: false };
}
