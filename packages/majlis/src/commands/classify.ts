import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, findProjectRoot } from '../db/connection.js';
import { spawnAgent } from '../agents/spawn.js';
import { autoCommit } from '../git.js';
import * as fmt from '../output/format.js';

export async function classify(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  const domain = args.filter(a => !a.startsWith('--')).join(' ');
  if (!domain) {
    throw new Error('Usage: majlis classify "domain description"');
  }

  // Read synthesis and dead-ends for context
  const synthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
  const synthesis = fs.existsSync(synthesisPath) ? fs.readFileSync(synthesisPath, 'utf-8') : '';

  const deadEndsPath = path.join(root, 'docs', 'synthesis', 'dead-ends.md');
  const deadEnds = fs.existsSync(deadEndsPath) ? fs.readFileSync(deadEndsPath, 'utf-8') : '';

  fmt.info(`Classifying problem domain: ${domain}`);

  const result = await spawnAgent('builder', {
    synthesis,
    taskPrompt:
      `Classify the following problem domain into canonical sub-types (Al-Khwarizmi method). ` +
      `For each sub-type: describe it, identify its canonical form, and list known constraints.\n\n` +
      `Domain: ${domain}\n\n` +
      `Dead-ends for context:\n${deadEnds}\n\n` +
      `Write the classification to docs/classification/ following the template.`,
  }, root);

  autoCommit(root, `classify: ${domain.slice(0, 60)}`);
  fmt.success('Classification complete. Check docs/classification/ for the output.');
}

export async function reframe(args: string[]): Promise<void> {
  const root = findProjectRoot();
  if (!root) throw new Error('Not in a Majlis project. Run `majlis init` first.');

  // Reframer ONLY sees: problem statement, classification, synthesis, dead-ends
  // NOT builder code or experiments
  const classificationDir = path.join(root, 'docs', 'classification');
  let classificationContent = '';
  if (fs.existsSync(classificationDir)) {
    const files = fs.readdirSync(classificationDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    for (const f of files) {
      classificationContent += fs.readFileSync(path.join(classificationDir, f), 'utf-8') + '\n\n';
    }
  }

  const synthesisPath = path.join(root, 'docs', 'synthesis', 'current.md');
  const synthesis = fs.existsSync(synthesisPath) ? fs.readFileSync(synthesisPath, 'utf-8') : '';

  const deadEndsPath = path.join(root, 'docs', 'synthesis', 'dead-ends.md');
  const deadEnds = fs.existsSync(deadEndsPath) ? fs.readFileSync(deadEndsPath, 'utf-8') : '';

  // Read config for problem statement
  const configPath = path.join(root, '.majlis', 'config.json');
  let problemStatement = '';
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    problemStatement = `${config.project?.description ?? ''}\nObjective: ${config.project?.objective ?? ''}`;
  }

  const target = args.filter(a => !a.startsWith('--')).join(' ') || 'current classification';

  fmt.info(`Reframing: ${target}`);

  const result = await spawnAgent('reframer', {
    synthesis,
    taskPrompt:
      `You are the Reframer. You receive ONLY the problem statement and classification — NOT builder code.\n\n` +
      `Problem Statement:\n${problemStatement}\n\n` +
      `Current Classification:\n${classificationContent}\n\n` +
      `Dead-End Registry:\n${deadEnds}\n\n` +
      `Independently propose a decomposition. Compare with the existing classification. ` +
      `Flag structural divergences — these are the most valuable signals.\n` +
      `Write to docs/reframes/.`,
  }, root);

  autoCommit(root, `reframe: ${target.slice(0, 60)}`);
  fmt.success('Reframe complete. Check docs/reframes/ for the output.');
}
