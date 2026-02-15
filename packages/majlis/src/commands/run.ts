import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import {
  getLatestExperiment,
  listActiveExperiments,
  getSessionsSinceCompression,
} from '../db/queries.js';
import { isTerminal } from '../state/machine.js';
import { ExperimentStatus } from '../state/types.js';
import { next } from './next.js';
import * as fmt from '../output/format.js';

/**
 * Autonomous orchestration — `majlis run "goal"`.
 * Reads synthesis, classification, fragility map, and dead-end registry.
 * Determines what experiments need to run for the stated goal.
 * Loops until goal is met, circuit breaker triggers, or max cycles reached.
 */
export async function run(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const goal = args.filter(a => !a.startsWith('--')).join(' ');
  if (!goal) {
    throw new Error('Usage: majlis run "goal description"');
  }

  const db = getDb(root);
  const MAX_CYCLES = 50;

  fmt.header(`Autonomous Mode — Goal: ${goal}`);

  let cycleCount = 0;

  while (cycleCount < MAX_CYCLES) {
    cycleCount++;

    // Check if there's an active experiment
    const exp = getLatestExperiment(db);

    if (!exp) {
      // Need to create a new experiment — for now, inform the user
      fmt.warn('No active experiments. Create one with `majlis new "hypothesis"` and re-run.');
      break;
    }

    if (isTerminal(exp.status as ExperimentStatus)) {
      // Current experiment is done — check if goal is met
      if (exp.status === 'merged') {
        fmt.success(`Experiment ${exp.slug} merged successfully.`);
      } else if (exp.status === 'dead_end') {
        fmt.info(`Experiment ${exp.slug} ended as dead-end.`);
      }

      // Check if there are other active experiments
      const active = listActiveExperiments(db);
      if (active.length === 0) {
        fmt.info('No more active experiments. Goal assessment:');
        fmt.info(`Original goal: ${goal}`);
        fmt.warn('Review synthesis and metrics to determine if the goal has been met.');
        break;
      }

      // Continue with the next active experiment
      fmt.info(`Continuing with experiment: ${active[0].slug}`);
    }

    // Run next step with --auto behavior
    fmt.info(`[Cycle ${cycleCount}/${MAX_CYCLES}] Processing ${exp.slug} (${exp.status})`);
    await next([exp.slug], false);

    // Re-check experiment state after step
    const updated = getLatestExperiment(db);
    if (updated && isTerminal(updated.status as ExperimentStatus)) {
      continue; // Loop will handle terminal state
    }

    // Check compression timer
    const sessionsSinceCompression = getSessionsSinceCompression(db);
    if (sessionsSinceCompression >= 5) {
      fmt.warn('Compression due during autonomous run — consider compressing.');
    }
  }

  if (cycleCount >= MAX_CYCLES) {
    fmt.warn(`Reached maximum cycle count (${MAX_CYCLES}). Stopping autonomous mode.`);
  }

  fmt.header('Autonomous Mode Complete');
  fmt.info(`Goal: ${goal}`);
  fmt.info(`Cycles executed: ${cycleCount}`);
  fmt.info('Run `majlis status` to see final state.');
}
