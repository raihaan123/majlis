import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import type { AgentDefinition, AgentResult, AgentContext, StructuredOutput } from './types.js';
import { extractStructuredData } from './parse.js';
import { findProjectRoot } from '../db/connection.js';

/**
 * Load an agent definition from .majlis/agents/{role}.md
 * Parses YAML frontmatter (name, model, tools) + markdown body as systemPrompt.
 */
export function loadAgentDefinition(role: string, projectRoot?: string): AgentDefinition {
  const root = projectRoot ?? findProjectRoot() ?? process.cwd();
  const filePath = path.join(root, '.majlis', 'agents', `${role}.md`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent definition not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(`Invalid agent definition (missing YAML frontmatter): ${filePath}`);
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  // Simple YAML parsing for our known fields (avoid yaml dependency)
  const name = extractYamlField(frontmatter, 'name') ?? role;
  const model = extractYamlField(frontmatter, 'model') ?? 'sonnet';
  const toolsStr = extractYamlField(frontmatter, 'tools') ?? '[]';
  const tools = toolsStr
    .replace(/[\[\]]/g, '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  return { name, model, tools, systemPrompt: body };
}

function extractYamlField(yaml: string, field: string): string | null {
  const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

/**
 * Write context data to a temp JSON file for the agent to read.
 */
export function writeTempContext(context: AgentContext): string {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `majlis-context-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(context, null, 2));
  return tmpFile;
}

/**
 * Spawn a Claude Code subagent with the specified role and context.
 * Uses --print --output-format stream-json per PRD v2 §4.6.
 */
export async function spawnAgent(
  role: string,
  context: AgentContext,
  projectRoot?: string,
): Promise<AgentResult> {
  const agentDef = loadAgentDefinition(role, projectRoot);
  const contextFile = writeTempContext(context);
  const root = projectRoot ?? findProjectRoot() ?? process.cwd();

  const taskPrompt = context.taskPrompt ?? `Perform your role as ${agentDef.name}.`;
  const prompt = `Read the context at ${contextFile}. ${taskPrompt}`;

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--model', agentDef.model,
    '--allowedTools', ...agentDef.tools,
    '--append-system-prompt', agentDef.systemPrompt,
    '-p', prompt,
  ];

  console.log(`[majlis] Spawning ${role} agent (model: ${agentDef.model})...`);

  const output = await runClaude(args, root);

  // Parse stream-json output — collect all text content
  const markdown = parseStreamJsonOutput(output);

  // Write artifact to docs/ directory
  const artifactPath = writeArtifact(role, context, markdown, root);
  if (artifactPath) {
    console.log(`[majlis] ${role} artifact written to ${artifactPath}`);
  }

  // Extract structured data via 3-tier parsing
  const structured = extractStructuredData(role, markdown);

  // Clean up temp file
  try { fs.unlinkSync(contextFile); } catch { /* ignore */ }

  return { output: markdown, structured };
}

/**
 * Spawn a small synthesiser micro-agent (for resolve step).
 * Not a full role — just a focused Haiku/Sonnet call.
 */
export async function spawnSynthesiser(
  context: AgentContext,
  projectRoot?: string,
): Promise<AgentResult> {
  const contextFile = writeTempContext(context);
  const root = projectRoot ?? findProjectRoot() ?? process.cwd();

  const prompt = `Read the context at ${contextFile}. ${context.taskPrompt ?? 'Synthesise the findings into actionable builder guidance.'}`;

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--model', 'sonnet',
    '--allowedTools', 'Read', 'Glob', 'Grep',
    '--append-system-prompt', 'You are a Synthesis Agent. Your job is to take a verification report, confirmed doubts, and adversarial test results, and compress them into specific, actionable guidance for the builder\'s next attempt. Be concrete: which decisions failed, which assumptions broke, what constraints must the next approach satisfy. Output a \'guidance\' field in JSON wrapped in a <!-- majlis-json --> block.',
    '-p', prompt,
  ];

  console.log(`[majlis] Spawning synthesiser micro-agent...`);
  const output = await runClaude(args, root);
  const markdown = parseStreamJsonOutput(output);
  const structured = extractStructuredData('synthesiser', markdown);

  try { fs.unlinkSync(contextFile); } catch { /* ignore */ }

  return { output: markdown, structured };
}

function runClaude(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

/**
 * Parse stream-json output from Claude --output-format stream-json.
 * Collects all assistant text content into a single markdown string.
 */
function parseStreamJsonOutput(raw: string): string {
  const parts: string[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      // stream-json events have different types
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            parts.push(block.text);
          }
        }
      } else if (event.type === 'content_block_delta' && event.delta?.text) {
        parts.push(event.delta.text);
      } else if (event.type === 'result' && event.result) {
        // Final result message
        if (typeof event.result === 'string') {
          parts.push(event.result);
        }
      }
    } catch {
      // Not JSON — might be raw text output
      if (line.trim()) parts.push(line);
    }
  }

  return parts.join('');
}

/**
 * Write agent output as a markdown artifact to the appropriate docs/ directory.
 */
function writeArtifact(
  role: string,
  context: AgentContext,
  markdown: string,
  projectRoot: string,
): string | null {
  const dirMap: Record<string, string> = {
    builder: 'docs/experiments',
    critic: 'docs/doubts',
    adversary: 'docs/challenges',
    verifier: 'docs/verification',
    reframer: 'docs/reframes',
    compressor: 'docs/synthesis',
    scout: 'docs/rihla',
  };

  const dir = dirMap[role];
  if (!dir) return null;

  const fullDir = path.join(projectRoot, dir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  // For compressor, write to current.md
  if (role === 'compressor') {
    const target = path.join(fullDir, 'current.md');
    fs.writeFileSync(target, markdown);
    return target;
  }

  // For other roles, create a numbered file
  const expSlug = context.experiment?.slug ?? 'general';
  const existing = fs.readdirSync(fullDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  const nextNum = String(existing.length + 1).padStart(3, '0');

  const filename = role === 'builder'
    ? `${nextNum}-${expSlug}.md`
    : `${nextNum}-${role}-${expSlug}.md`;

  const target = path.join(fullDir, filename);
  fs.writeFileSync(target, markdown);
  return target;
}
