#!/usr/bin/env node

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    return;
  }

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    return;
  }

  const isJson = args.includes('--json');
  const command = args[0];
  const rest = args.slice(1).filter(a => a !== '--json');

  try {
    switch (command) {
      case 'init': {
        const { init } = await import('./commands/init.js');
        await init(rest);
        break;
      }
      case 'status': {
        const { status } = await import('./commands/status.js');
        await status(isJson);
        break;
      }
      case 'new': {
        const { newExperiment } = await import('./commands/experiment.js');
        await newExperiment(rest);
        break;
      }
      case 'revert': {
        const { revert } = await import('./commands/experiment.js');
        await revert(rest);
        break;
      }
      case 'baseline': {
        const { baseline } = await import('./commands/measure.js');
        await baseline(rest);
        break;
      }
      case 'measure': {
        const { measure } = await import('./commands/measure.js');
        await measure(rest);
        break;
      }
      case 'compare': {
        const { compare } = await import('./commands/measure.js');
        await compare(rest, isJson);
        break;
      }
      case 'session': {
        const { session } = await import('./commands/session.js');
        await session(rest);
        break;
      }
      case 'decisions':
      case 'dead-ends':
      case 'fragility':
      case 'history':
      case 'circuit-breakers':
      case 'check-commit': {
        const { query } = await import('./commands/query.js');
        await query(command, rest, isJson);
        break;
      }
      case 'build':
      case 'challenge':
      case 'doubt':
      case 'scout':
      case 'verify':
      case 'compress': {
        const { cycle } = await import('./commands/cycle.js');
        await cycle(command, rest);
        break;
      }
      case 'resolve': {
        const { resolveCmd } = await import('./commands/cycle.js');
        await resolveCmd(rest);
        break;
      }
      case 'classify': {
        const { classify } = await import('./commands/classify.js');
        await classify(rest);
        break;
      }
      case 'reframe': {
        const { reframe } = await import('./commands/classify.js');
        await reframe(rest);
        break;
      }
      case 'next': {
        const { next } = await import('./commands/next.js');
        await next(rest, isJson);
        break;
      }
      case 'run': {
        const { run } = await import('./commands/run.js');
        await run(rest);
        break;
      }
      case 'audit': {
        const { audit } = await import('./commands/audit.js');
        await audit(rest);
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m[majlis] Error: ${msg}\x1b[0m`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
majlis v${VERSION} — Structured multi-agent problem solving

Usage: majlis <command> [options]

Lifecycle:
  init                       Initialize Majlis in current project
  status [--json]            Show experiment states and cycle position

Experiments:
  new "hypothesis"           Create experiment, branch, log, DB entry
  baseline                   Capture metrics snapshot (before)
  measure                    Capture metrics snapshot (after)
  compare [--json]           Compare before/after, detect regressions
  revert                     Revert experiment, log to dead-end

Cycle:
  next [experiment] [--auto] Determine and execute next cycle step
  build [experiment]         Spawn builder agent
  challenge [experiment]     Spawn adversary agent
  doubt [experiment]         Spawn critic agent
  scout [experiment]         Spawn scout agent
  verify [experiment]        Spawn verifier agent
  resolve [experiment]       Route based on verification grades
  compress                   Spawn compressor agent

Classification:
  classify "domain"          Classify problem space into sub-types
  reframe [classification]   Independent decomposition

Queries:
  decisions [--level L]      List decisions by evidence level
  dead-ends [--sub-type S]   Dead-ends with structural constraints
  fragility                  Show fragility map
  history [fixture]          Metric history for a fixture
  circuit-breakers           Sub-type failure counts
  check-commit               Exit non-zero if unverified experiments

Audit:
  audit "objective"          Maqasid check — is the frame right?

Sessions:
  session start "intent"     Declare session intent
  session end                Log accomplished/unfinished/fragility

Orchestration:
  run "goal"                 Autonomous orchestration until goal met

Flags:
  --json                     Output as JSON
  --version, -v              Print version
  --help, -h                 Print this help
`);
}

main();
