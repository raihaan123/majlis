import * as fs from 'node:fs';
import * as path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
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
  const model = extractYamlField(frontmatter, 'model') ?? 'opus';
  const toolsStr = extractYamlField(frontmatter, 'tools') ?? '[]';
  const tools = toolsStr
    .replace(/[\[\]]/g, '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  return { name, model, tools, systemPrompt: body };
}

/** Per-role turn limits — hard cap to prevent agent spirals. */
const ROLE_MAX_TURNS: Record<string, number> = {
  builder: 50,
  critic: 30,
  adversary: 30,
  verifier: 50,
  compressor: 30,
  reframer: 20,
  scout: 20,
};

function extractYamlField(yaml: string, field: string): string | null {
  const match = yaml.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

/**
 * Spawn a Claude agent with the specified role and context.
 * Uses the Claude Agent SDK for in-process execution.
 */
export async function spawnAgent(
  role: string,
  context: AgentContext,
  projectRoot?: string,
): Promise<AgentResult> {
  const agentDef = loadAgentDefinition(role, projectRoot);
  const root = projectRoot ?? findProjectRoot() ?? process.cwd();

  const taskPrompt = context.taskPrompt ?? `Perform your role as ${agentDef.name}.`;
  const contextJson = JSON.stringify(context, null, 2);
  const prompt = `Here is your context:\n\n\`\`\`json\n${contextJson}\n\`\`\`\n\n${taskPrompt}`;

  const turns = ROLE_MAX_TURNS[role] ?? 15;
  console.log(`[${role}] Spawning (model: ${agentDef.model}, maxTurns: ${turns})...`);

  const { text: markdown, costUsd } = await runQuery({
    prompt,
    model: agentDef.model,
    tools: agentDef.tools,
    systemPrompt: agentDef.systemPrompt,
    cwd: root,
    maxTurns: turns,
    label: role,
  });

  console.log(`[${role}] Complete (cost: $${costUsd.toFixed(4)})`);

  // Write artifact to docs/ directory
  const artifactPath = writeArtifact(role, context, markdown, root);
  if (artifactPath) {
    console.log(`[${role}] Artifact written to ${artifactPath}`);
  }

  // Extract structured data via 3-tier parsing
  const structured = await extractStructuredData(role, markdown);

  return { output: markdown, structured };
}

/**
 * Spawn a small synthesiser micro-agent (for resolve step).
 * Not a full role — just a focused Sonnet call.
 */
export async function spawnSynthesiser(
  context: AgentContext,
  projectRoot?: string,
): Promise<AgentResult> {
  const root = projectRoot ?? findProjectRoot() ?? process.cwd();

  const contextJson = JSON.stringify(context, null, 2);
  const taskPrompt = context.taskPrompt ?? 'Synthesise the findings into actionable builder guidance.';
  const prompt = `Here is your context:\n\n\`\`\`json\n${contextJson}\n\`\`\`\n\n${taskPrompt}`;

  const systemPrompt =
    'You are a Synthesis Agent. Be concrete: which decisions failed, which assumptions broke, ' +
    'what constraints must the next approach satisfy. ' +
    'CRITICAL: Your LAST line of output MUST be a <!-- majlis-json --> block. ' +
    'The framework parses this programmatically — if you omit it, the pipeline breaks. ' +
    'Format: <!-- majlis-json {"guidance": "your guidance here"} -->';

  console.log(`[synthesiser] Spawning (maxTurns: 5)...`);

  const { text: markdown, costUsd } = await runQuery({
    prompt,
    model: 'opus',
    tools: ['Read', 'Glob', 'Grep'],
    systemPrompt,
    cwd: root,
    maxTurns: 5,
    label: 'synthesiser',
  });

  console.log(`[synthesiser] Complete (cost: $${costUsd.toFixed(4)})`);

  // The synthesiser's output IS the guidance — skip 3-tier extraction
  // (it never outputs <!-- majlis-json --> reliably, wasting a Haiku call).
  return { output: markdown, structured: { guidance: markdown } };
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';

/**
 * Run a Claude Agent SDK query and collect the text output.
 * Streams live progress to stderr so the user can see what's happening.
 */
async function runQuery(opts: {
  prompt: string;
  model: string;
  tools: string[];
  systemPrompt: string;
  cwd: string;
  maxTurns?: number;
  label?: string;
}): Promise<{ text: string; costUsd: number }> {
  const tag = opts.label ?? 'majlis';
  const conversation = query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      tools: opts.tools,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: opts.systemPrompt,
      },
      cwd: opts.cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: opts.maxTurns ?? 15,
      persistSession: false,
      settingSources: ['project'],
    },
  });

  const textParts: string[] = [];
  let costUsd = 0;
  let turnCount = 0;

  for await (const message of conversation) {
    if (message.type === 'assistant') {
      turnCount++;
      let hasText = false;
      for (const block of message.message.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
          hasText = true;
        } else if (block.type === 'tool_use') {
          const toolName = (block as any).name ?? 'tool';
          const input = (block as any).input ?? {};
          const detail = formatToolDetail(toolName, input);
          process.stderr.write(`${DIM}[${tag}]   ${CYAN}${toolName}${RESET}${DIM}${detail}${RESET}\n`);
        }
      }
      if (hasText) {
        // Show a brief preview of the text output
        const preview = textParts[textParts.length - 1].slice(0, 120).replace(/\n/g, ' ').trim();
        if (preview) {
          process.stderr.write(`${DIM}[${tag}]   writing: ${preview}${preview.length >= 120 ? '...' : ''}${RESET}\n`);
        }
      }
    } else if (message.type === 'tool_progress') {
      const elapsed = Math.round(message.elapsed_time_seconds);
      if (elapsed > 0 && elapsed % 5 === 0) {
        process.stderr.write(`${DIM}[${tag}]   ${message.tool_name} running (${elapsed}s)...${RESET}\n`);
      }
    } else if (message.type === 'result') {
      if (message.subtype === 'success') {
        costUsd = message.total_cost_usd;
      } else if (message.subtype === 'error_max_turns') {
        // Agent hit turn limit — return partial output instead of throwing.
        // The cycle can still use whatever the agent produced.
        costUsd = 'total_cost_usd' in message ? (message as any).total_cost_usd : 0;
        console.warn(`[${tag}] Hit max turns (${turnCount}). Returning partial output.`);
      } else {
        const errors = 'errors' in message ? (message.errors?.join('; ') ?? 'Unknown error') : 'Unknown error';
        throw new Error(`Agent query failed (${message.subtype}): ${errors}`);
      }
    }
  }

  return { text: textParts.join('\n\n'), costUsd };
}

/**
 * Format a brief detail string for a tool use event.
 */
function formatToolDetail(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case 'Read':
      return input.file_path ? ` ${input.file_path}` : '';
    case 'Write':
      return input.file_path ? ` → ${input.file_path}` : '';
    case 'Edit':
      return input.file_path ? ` ${input.file_path}` : '';
    case 'Glob':
      return input.pattern ? ` ${input.pattern}` : '';
    case 'Grep':
      return input.pattern ? ` /${input.pattern}/` : '';
    case 'Bash':
      return input.command ? ` $ ${input.command.slice(0, 80)}` : '';
    case 'WebSearch':
      return input.query ? ` "${input.query}"` : '';
    default:
      return '';
  }
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
  const nextNum = String(context.experiment?.id ?? existing.length + 1).padStart(3, '0');

  const filename = role === 'builder'
    ? `${nextNum}-${expSlug}.md`
    : `${nextNum}-${role}-${expSlug}.md`;

  const target = path.join(fullDir, filename);
  fs.writeFileSync(target, markdown);
  return target;
}
