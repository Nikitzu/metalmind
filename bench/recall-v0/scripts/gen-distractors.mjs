#!/usr/bin/env node
// Seeded, template-based distractor generator for recall-v0.
// Emits topically-plausible Quillfly (fictional drone co.) notes that do NOT
// match any question in questions.json. Same domain as gold → distractors
// compete with gold in embedding space, which is what we want to measure.
//
// Deterministic: same --seed produces the same files byte-for-byte.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'fake-vault-distractors');

function parseArgs(argv) {
  const out = { n: 1000, seed: 42, outDir: OUT_DIR, clean: true };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--n') out.n = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--no-clean') out.clean = false;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'usage: gen-distractors.mjs [--n 1000] [--seed 42] [--out <dir>] [--no-clean]\n',
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.n) || out.n < 1) throw new Error(`bad --n: ${out.n}`);
  if (!Number.isFinite(out.seed)) throw new Error(`bad --seed: ${out.seed}`);
  return out;
}

// mulberry32 — small, fast, seedable PRNG. Deterministic across Node versions.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const r = mulberry32(seed);
  return {
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    int: (lo, hi) => Math.floor(r() * (hi - lo + 1)) + lo,
    bool: (p = 0.5) => r() < p,
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    next: r,
  };
}

// -----------------------------------------------------------------------------
// Vocabulary. Same domain as gold notes (Quillfly drone co.) but strictly
// DISJOINT subjects — nothing here should match any question in questions.json.
// -----------------------------------------------------------------------------

const SKU = [
  'QF-14',
  'QF-22',
  'QF-47',
  'QF-58',
  'QF-61',
  'QF-73',
  'QF-84',
  'QF-92',
  'WR-03',
  'WR-11',
  'SP-5',
  'SP-8',
];

const TEAM = [
  'fleet-ops',
  'edge-firmware',
  'ground-control',
  'field-service',
  'warehouse-ops',
  'partnerships',
  'compliance',
  'customer-success',
  'growth',
  'people-ops',
  'finance',
  'legal',
];

const PERSON = [
  'maria',
  'jonas',
  'priya',
  'hiroshi',
  'adrienne',
  'luca',
  'tomas',
  'renata',
  'dmitri',
  'saskia',
  'cormac',
  'yelena',
];

const VENDOR = [
  'Stratus Power',
  'Meridian Logistics',
  'Helix Composites',
  'Portia Optics',
  'Kestrel Networks',
  'Oakridge Batteries',
  'Lumen Sensors',
  'Pangea Chassis',
  'Ferrite Motors',
];

const REGION = [
  'europe-west4',
  'europe-west1',
  'us-central1',
  'asia-northeast1',
  'me-central1',
];

const QUARTER = ['Q1', 'Q2', 'Q3', 'Q4'];
const YEAR = ['2025', '2026'];

const MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// -----------------------------------------------------------------------------
// Templates. Each returns { name, type, body } given rng. Topics are chosen so
// they don't overlap with any gold question. No "auth", "Postgres vs Cockroach",
// "RLS", "incident Feb 14", "pricing tiers", "hiring freeze", "wingspan",
// "observability", "SDK versions", "team roster", "tech stack", or
// "deployment targets" content here.
// -----------------------------------------------------------------------------

const TEMPLATES = [
  // 0: warehouse / inventory
  (r) => {
    const sku = r.pick(SKU);
    const count = r.int(40, 320);
    const mo = r.pick(MONTH);
    const year = r.pick(YEAR);
    const vendor = r.pick(VENDOR);
    return {
      name: `inventory snapshot — ${sku} ${mo} ${year}`,
      type: 'inventory',
      body: `${sku} on-hand count is ${count} units as of ${mo} ${year}.\n\nPrimary supplier ${vendor}; reorder threshold 60 units, lead time 22 days. Warehouse bin is W-${r.int(1, 24)}-${r.int(1, 48)}.`,
    };
  },
  // 1: travel / conference
  (r) => {
    const person = r.pick(PERSON);
    const conf = r.pick([
      'DroneWorld',
      'AUVSI Xponential',
      'InterDrone Expo',
      'Commercial UAV Expo',
      'Heli-Expo',
    ]);
    const city = r.pick(['Berlin', 'Dallas', 'Singapore', 'Toronto', 'Lisbon', 'Dubai']);
    const mo = r.pick(MONTH);
    return {
      name: `travel approved — ${person} / ${conf}`,
      type: 'travel',
      body: `${person} attending ${conf} in ${city}, ${mo}. Budget cap $${r.int(1500, 4800)}, return flight economy, per diem standard. Approved by finance ${r.pick(PERSON)}.`,
    };
  },
  // 2: vendor contract renewal
  (r) => {
    const vendor = r.pick(VENDOR);
    const quarter = r.pick(QUARTER);
    const year = r.pick(YEAR);
    return {
      name: `contract renewal — ${vendor} ${quarter} ${year}`,
      type: 'contract',
      body: `Renewal with ${vendor} closes ${quarter} ${year}. Price locked for 18 months, ${r.int(3, 12)}% volume rebate above ${r.int(500, 2000)} units/yr. Owner: ${r.pick(PERSON)} (partnerships). No exclusivity clause.`,
    };
  },
  // 3: sprint retro
  (r) => {
    const team = r.pick(TEAM);
    const n = r.int(14, 78);
    return {
      name: `${team} retro — sprint ${n}`,
      type: 'retro',
      body: `What went well: shipped ${r.int(2, 6)} stories, paired on the ${r.pick(['camera pipeline', 'nav controller', 'telemetry flush', 'OTA queue'])} refactor.\n\nWhat didn't: code-review latency crept to ${r.int(26, 72)}h p95. Action: rotate reviewers weekly, cap at 2 open reviews per person.\n\nKudos to ${r.pick(PERSON)} for the weekend pager cover.`,
    };
  },
  // 4: OKR check-in
  (r) => {
    const team = r.pick(TEAM);
    const quarter = r.pick(QUARTER);
    const year = r.pick(YEAR);
    const pct = r.int(30, 95);
    return {
      name: `${team} OKRs ${quarter} ${year} check-in`,
      type: 'okr',
      body: `KR1: ${pct}% complete. KR2: on track. KR3: at risk — ${r.pick(['vendor slipped', 'hiring gap', 'scope larger than sized', 'dependency on edge-firmware team'])}. Mitigation owner: ${r.pick(PERSON)}.`,
    };
  },
  // 5: onboarding doc
  (r) => {
    const team = r.pick(TEAM);
    return {
      name: `onboarding — ${team} week 1`,
      type: 'onboarding',
      body: `Day 1: laptop setup, access requests (filed by IT, ~${r.int(2, 5)}h turnaround), intro meetings.\n\nDay 2–3: shadow an on-call rotation. Read the ${team} runbook in the wiki.\n\nWeek-1 goal: ship one trivial PR (doc typo is fine). Buddy: ${r.pick(PERSON)}.`,
    };
  },
  // 6: firmware release notes (distinct from SDK — internal edge firmware)
  (r) => {
    const sku = r.pick(SKU);
    const major = r.int(1, 4);
    const minor = r.int(0, 12);
    const patch = r.int(0, 30);
    return {
      name: `firmware ${sku} v${major}.${minor}.${patch}`,
      type: 'firmware',
      body: `Changes:\n- Fix drift in IMU calibration after thermal cycles (tracked as ${sku}-${r.int(100, 999)}).\n- Reduce OTA download time by batching telemetry flush.\n- Bump tokio to 1.${r.int(30, 40)}.\n\nRollout: canary fleet (${r.int(5, 20)} units) for 72h, then full fleet gated on pager-quiet window.`,
    };
  },
  // 7: QA / flight test log
  (r) => {
    const sku = r.pick(SKU);
    const runs = r.int(8, 42);
    return {
      name: `flight test log — ${sku} week ${r.int(1, 52)}`,
      type: 'qa',
      body: `Runs: ${runs}. Pass: ${runs - r.int(0, 3)}. Issues: ${r.pick(['battery sag under 20% charge', 'GPS reacquisition >8s after tunnel egress', 'camera autofocus hunts in low light', 'rotor harmonic at 87% throttle'])}. Filed as QF-${r.int(200, 900)}. Pilot: ${r.pick(PERSON)}.`,
    };
  },
  // 8: legal / privacy review (does NOT mention auth / RLS / multi-tenancy)
  (r) => {
    const feature = r.pick([
      'flight-path replay export',
      'pilot-performance dashboard',
      'operator notes share link',
      'maintenance photo gallery',
    ]);
    return {
      name: `privacy review — ${feature}`,
      type: 'legal',
      body: `Reviewed by ${r.pick(PERSON)} (legal). Data classes: operational telemetry only, no PII beyond operator email. Retention: ${r.int(30, 365)} days, auto-purged. DPA update: not required. GDPR RoPA updated ${r.pick(MONTH)}.`,
    };
  },
  // 9: marketing launch plan
  (r) => {
    const feature = r.pick([
      'fleet heatmap',
      'weather overlay',
      'auto-return-to-base',
      'multi-operator chat',
      'maintenance scheduler',
    ]);
    const mo = r.pick(MONTH);
    return {
      name: `launch plan — ${feature} ${mo}`,
      type: 'marketing',
      body: `GA target: ${mo} ${r.pick(YEAR)}. Beta cohort: ${r.int(4, 18)} enterprise customers. Launch channels: blog post, newsletter, webinar with ${r.pick(PERSON)} presenting. Success metric: ${r.int(20, 60)}% beta-to-paid conversion.`,
    };
  },
  // 10: customer support macro
  (r) => {
    const topic = r.pick([
      'drone stuck in RTB',
      'console shows stale telemetry',
      'operator cannot invite teammate',
      'export CSV has missing columns',
      'camera stream buffering',
    ]);
    return {
      name: `support macro — ${topic}`,
      type: 'support',
      body: `Triage:\n1. Confirm firmware ≥ v${r.int(2, 4)}.${r.int(0, 10)}.\n2. Check console browser console for 4xx/5xx (common: stale session, hard refresh fixes).\n3. If persists, grab operator ID + timestamp, escalate to ${r.pick(TEAM)}.\n\nKB article ID: KB-${r.int(1000, 5000)}.`,
    };
  },
  // 11: RFC — non-overlapping topic (not tech-stack, not deployment)
  (r) => {
    const topic = r.pick([
      'rate-limit tier redesign',
      'feature-flag naming convention',
      'changelog automation',
      'per-environment config layering',
      'internal API client generation',
      'shared lint rule package',
    ]);
    const n = r.int(10, 180);
    return {
      name: `RFC-${String(n).padStart(3, '0')} — ${topic}`,
      type: 'rfc',
      body: `Status: draft. Author: ${r.pick(PERSON)}.\n\nProblem: current approach couples ${r.pick(['config', 'flags', 'lint', 'clients'])} across services, churn is ${r.int(3, 15)} PRs/week.\n\nProposal: extract to a shared package, opt-in migration, deprecate old path over ${r.int(2, 6)} quarters.\n\nOpen question: do we version the package semver-strict or calendar?`,
    };
  },
  // 12: infra / platform note (distinct from deployment-targets gold)
  (r) => {
    const topic = r.pick([
      'NATS consumer lag',
      'Redis memory ceiling',
      'GCS egress cost',
      'load balancer timeout tuning',
      'canary fleet size',
    ]);
    return {
      name: `platform note — ${topic}`,
      type: 'platform',
      body: `Observed: ${r.pick(['p95 spiked to ', 'error rate climbed past ', 'queue depth held above '])}${r.int(40, 900)}${r.pick(['ms', '% over 5m', ' messages'])} during the ${r.pick(['Monday peak', 'Friday ramp-down', 'Tuesday batch window'])}.\n\nCurrent theory: ${r.pick(['subscriber count grew faster than partition rebalance', 'GC pause during snapshot', 'TLS handshake cost from new region'])}. Next step: instrument, review ${r.pick(['next week', 'after this sprint', 'at the platform sync'])}.`,
    };
  },
  // 13: people-ops / policy (not hiring-freeze, not team)
  (r) => {
    const topic = r.pick([
      'remote work reimbursement',
      'stipend allocation',
      'all-hands cadence',
      'volunteer time off',
      'equipment refresh cycle',
    ]);
    return {
      name: `policy — ${topic}`,
      type: 'policy',
      body: `Effective ${r.pick(MONTH)} ${r.pick(YEAR)}. Applies to all ${r.pick(['full-time', 'regular', 'permanent'])} staff. Cap: $${r.int(200, 2400)}/${r.pick(['month', 'quarter', 'year'])}. Request flow: ${r.pick(PERSON)} approves in ${r.pick(['Ramp', 'the people-ops Slack', 'the HRIS'])}. Questions → people-ops.`,
    };
  },
  // 14: project note — non-overlapping (not "wingspan")
  (r) => {
    const project = r.pick([
      'project-talon',
      'project-cinder',
      'project-glimmer',
      'project-halyard',
      'project-tessera',
      'project-anvil',
    ]);
    const mo = r.pick(MONTH);
    return {
      name: `${project} — ${mo} update`,
      type: 'project',
      body: `Scope: ${r.pick(['ground-control UX overhaul', 'telemetry compression', 'geofence authoring tool', 'maintenance intake form', 'accounting export pipeline'])}.\n\nStatus: ${r.pick(['on track', 'slipping one sprint', 'blocked on vendor', 'ready for review'])}. Owner: ${r.pick(PERSON)}. Dependency on ${r.pick(TEAM)}: ${r.pick(['resolved', 'pending', 'escalated'])}. Next checkpoint: ${r.pick(MONTH)}.`,
    };
  },
  // 15: CI / build note
  (r) => {
    return {
      name: `CI note — ${r.pick(['flaky test', 'slow build', 'cache miss', 'artefact bloat'])} ${r.pick(QUARTER)} ${r.pick(YEAR)}`,
      type: 'ci',
      body: `${r.pick(['e2e-smoke', 'integration-fleet', 'unit-edge', 'lint-all'])} duration crept from ${r.int(3, 9)}m to ${r.int(10, 24)}m over ${r.int(2, 8)} weeks. Culprit: ${r.pick(['pnpm cache thrash', 'Docker layer bust on every run', 'fixtures regenerated per-test', 'cross-compile hit after toolchain bump'])}. Fix landing ${r.pick(MONTH)} — tracked QF-${r.int(400, 990)}.`,
    };
  },
];

// -----------------------------------------------------------------------------
// Render one note.
// -----------------------------------------------------------------------------

function renderNote(rng, index) {
  const tpl = TEMPLATES[index % TEMPLATES.length];
  const fields = tpl(rng);
  return `---\nname: ${fields.name}\ntype: ${fields.type}\n---\n\n${fields.body}\n`;
}

function noteFilename(i) {
  return `distractor-${String(i).padStart(4, '0')}.md`;
}

// -----------------------------------------------------------------------------
// Main.
// -----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const rng = makeRng(args.seed);

  if (args.clean) {
    await rm(args.outDir, { recursive: true, force: true });
  }
  await mkdir(args.outDir, { recursive: true });

  // Generate in a fixed order so --n 100 produces a prefix of --n 1000.
  // Template index is (i - 1) % TEMPLATES.length, so every N also samples
  // roughly evenly across topic categories.
  for (let i = 1; i <= args.n; i += 1) {
    const body = renderNote(rng, i - 1);
    const path = join(args.outDir, noteFilename(i));
    await writeFile(path, body, 'utf8');
  }

  process.stdout.write(
    `wrote ${args.n} distractor notes to ${args.outDir} (seed=${args.seed})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`gen-distractors failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
