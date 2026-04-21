#!/usr/bin/env node
// Measures the first-turn token tax each memory system imposes on a fresh
// Claude session — before the user has typed anything. Reads tool-manifest
// fixtures from ./fixtures, calls Anthropic's /v1/messages/count_tokens with
// each manifest as the `tools` parameter, and writes results to ./results.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node bench/mcp-tax-v0/run.mjs
//   node bench/mcp-tax-v0/run.mjs --offline   # skip API, use char/4 approximation

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');
const RESULTS_DIR = join(HERE, 'results');

const OFFLINE = process.argv.includes('--offline') || !process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.METALMIND_BENCH_MODEL ?? 'claude-sonnet-4-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const APPROX_CHARS_PER_TOKEN = 4;
function approxTokens(text) {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

async function countTokensApi({ tools, system }) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: 'x' }],
  };
  if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
  if (system) body.system = system;
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`count_tokens ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.input_tokens;
}

function toAnthropicTools(fixtureTools) {
  return fixtureTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.input_schema ?? t.inputSchema ?? { type: 'object', properties: {} },
  }));
}

async function measureFixture(name, fixture, instructionBlockText) {
  const tools = toAnthropicTools(fixture.tools ?? []);
  const toolsSerialized = JSON.stringify(tools);

  // Baseline: minimal user message, no tools, no system — the floor any call pays.
  // Tax: baseline + tools vs. baseline alone.
  const result = {
    name,
    transport: fixture.transport ?? inferTransport(name),
    tool_count: tools.length,
    tools_json_chars: toolsSerialized.length,
  };

  if (OFFLINE) {
    result.mode = 'offline-approximation';
    result.tools_tokens_approx = approxTokens(toolsSerialized);
    if (instructionBlockText) {
      result.instruction_block_tokens_approx = approxTokens(instructionBlockText);
    }
    result.first_turn_tokens_approx =
      result.tools_tokens_approx + (result.instruction_block_tokens_approx ?? 0);
    return result;
  }

  result.mode = 'anthropic-count-tokens';
  result.model = MODEL;

  // Baseline the empty call once — same for all fixtures.
  const baseline = await countTokensApi({});
  result._baseline_tokens = baseline;

  const withTools = await countTokensApi({ tools });
  result.tools_tokens = withTools - baseline;

  if (instructionBlockText) {
    const withInstructions = await countTokensApi({ system: instructionBlockText });
    result.instruction_block_tokens = withInstructions - baseline;
  }

  result.first_turn_tokens =
    result.tools_tokens + (result.instruction_block_tokens ?? 0);
  return result;
}

function inferTransport(name) {
  if (name.includes('loopback')) return 'loopback-http';
  if (name.includes('native')) return 'none (CLAUDE.md text only)';
  if (name.includes('stdio')) return 'stdio MCP';
  return 'stdio MCP';
}

async function main() {
  const entries = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json'));
  const instructionBlockPath = join(FIXTURES_DIR, 'metalmind-instruction-block.txt');
  const instructionBlockText = await readFile(instructionBlockPath, 'utf8').catch(
    () => null,
  );

  const results = [];
  for (const file of entries) {
    const name = basename(file, '.json');
    const raw = await readFile(join(FIXTURES_DIR, file), 'utf8');
    const fixture = JSON.parse(raw);
    // Attach the instruction block only to the metalmind-loopback fixture —
    // that is where the "text-block-instead-of-schema" trade happens.
    const attachInstructionBlock = name === 'metalmind-loopback';
    const res = await measureFixture(
      name,
      fixture,
      attachInstructionBlock ? instructionBlockText : null,
    );
    results.push(res);
    const tax =
      res.first_turn_tokens ?? res.first_turn_tokens_approx ?? res.tools_tokens_approx;
    console.log(
      `${name.padEnd(32)} tools=${String(res.tool_count).padStart(2)} ` +
        `chars=${String(res.tools_json_chars).padStart(5)} ` +
        `tokens=${String(tax).padStart(5)} (${res.mode})`,
    );
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const latest = {
    generated_at: new Date().toISOString(),
    mode: OFFLINE ? 'offline-approximation' : 'anthropic-count-tokens',
    model: OFFLINE ? null : MODEL,
    approx_chars_per_token: OFFLINE ? APPROX_CHARS_PER_TOKEN : null,
    results,
  };
  await writeFile(
    join(RESULTS_DIR, 'results-latest.json'),
    `${JSON.stringify(latest, null, 2)}\n`,
  );

  const headers = [
    'name',
    'transport',
    'tool_count',
    'tools_json_chars',
    'tools_tokens',
    'instruction_block_tokens',
    'first_turn_tokens',
    'mode',
  ];
  const rows = results.map((r) =>
    headers
      .map((h) => {
        const v =
          r[h] ??
          r[`${h}_approx`] ??
          (h === 'tools_tokens'
            ? r.tools_tokens_approx
            : h === 'instruction_block_tokens'
              ? r.instruction_block_tokens_approx
              : h === 'first_turn_tokens'
                ? r.first_turn_tokens_approx
                : '');
        return typeof v === 'string' ? `"${v.replaceAll('"', '""')}"` : String(v ?? '');
      })
      .join(','),
  );
  await writeFile(
    join(RESULTS_DIR, 'results-latest.csv'),
    `${[headers.join(','), ...rows].join('\n')}\n`,
  );

  printMarkdownTable(results);
  console.log(`Wrote results to ${RESULTS_DIR}/results-latest.{json,csv}`);
}

function printMarkdownTable(results) {
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  const order = [
    'metalmind-loopback',
    'claude-code-native-memory',
    'metalmind-stdio',
    'mem0',
  ];
  const tokensOf = (r) =>
    r.first_turn_tokens ?? r.first_turn_tokens_approx ?? r.tools_tokens_approx ?? 0;
  const rows = order
    .filter((n) => byName[n])
    .map((n) => {
      const r = byName[n];
      const suffix = n === 'metalmind-loopback' ? ' *(one-time CLAUDE.md block)*' : '';
      return `| ${n} | ${r.transport} | ${r.tool_count} | ${tokensOf(r)}${suffix} |`;
    });
  console.log('\n### MCP-tax v0 — first-turn token tax\n');
  console.log('| System | Transport | Tools | First-turn tokens |');
  console.log('|---|---|---:|---:|');
  for (const row of rows) console.log(row);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
