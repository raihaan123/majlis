import * as fs from 'node:fs';
import * as path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { HookCallback, HookCallbackMatcher, HookEvent, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, AgentResult, AgentContext, StructuredOutput } from './types.js';
import { extractStructuredData, validateForRole } from './parse.js';
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
  gatekeeper: 10,
  diagnostician: 60,
  cartographer: 40,
  toolsmith: 30,
};

/** Tool-use intervals at which to inject checkpoint grounding reminders. */
const CHECKPOINT_INTERVAL: Record<string, number> = {
  builder: 15,
  verifier: 12,
  critic: 15,
  adversary: 15,
  compressor: 15,
  gatekeeper: 2,
  diagnostician: 20,
  cartographer: 12,
  toolsmith: 10,
};

/**
 * Build role-specific checkpoint grounding message.
 * Injected as additionalContext via PostToolUse hooks.
 */
function buildCheckpointMessage(role: string, toolUseCount: number, maxTurns: number): string {
  const approxTurn = Math.round(toolUseCount / 2);
  const header = `[MAJLIS CHECKPOINT — ~${approxTurn} of ${maxTurns} turns used]`;

  switch (role) {
    case 'builder':
      return `${header}\nReminder: ONE code change per cycle.\n` +
        `- Have you run the benchmark? YES → document results + output JSON + STOP.\n` +
        `- If NO → run it now, then wrap up.\n` +
        `Do NOT start a second change or investigate unrelated failures.`;
    case 'verifier':
      return `${header}\nAT MOST 3 diagnostic scripts total.\n` +
        `- If ≥3 scripts run → produce grades + output JSON now.\n` +
        `- Trust framework metrics. Do not re-derive from raw data.`;
    case 'critic':
      return `${header}\nFocus on the SINGLE weakest assumption.\n` +
        `- Have you identified the core doubt? YES → write it up + output JSON.\n` +
        `- Do not enumerate every possible concern — pick the most dangerous one.`;
    case 'adversary':
      return `${header}\nDesign ONE targeted challenge, not a test suite.\n` +
        `- Have you defined the challenge? YES → write it up + output JSON.\n` +
        `- Focus on what would DISPROVE the hypothesis, not general testing.`;
    case 'compressor':
      return `${header}\nYou may ONLY write to docs/synthesis/.\n` +
        `- Have you updated current.md, fragility.md, dead-ends.md?\n` +
        `- If yes → output compression report JSON.\n` +
        `- Do NOT write to MEMORY.md or files outside docs/synthesis/.`;
    case 'gatekeeper':
      return `${header}\nThis is a FAST gate. You have 10 turns MAX.\n` +
        `DO NOT read source code or large files. Decide from the context provided.\n` +
        `Output your gate_decision JSON NOW — grade (sound/good/weak/fail) + reasoning.`;
    case 'diagnostician':
      return `${header}\nYou are READ-ONLY for project code. Write ONLY to .majlis/scripts/.\n` +
        `Focus on diagnosis, not fixing. Your value is insight, not implementation.\n` +
        `Phase 1 (1-10): orientation. Phase 2 (11-40): deep investigation. Phase 3 (41-60): synthesis.\n` +
        `If you are past turn 40, begin compiling your diagnostic report.`;
    case 'cartographer':
      return `${header}\nYou write ONLY to docs/synthesis/. You are mapping architecture.\n` +
        `Phase 1 (1-10): orientation. Phase 2 (11-30): architecture mapping. Phase 3 (31-40): write synthesis.\n` +
        `If you are past turn 30, begin writing current.md and fragility.md NOW.`;
    case 'toolsmith':
      return `${header}\nYou write ONLY to .majlis/scripts/. Verify toolchain, create metrics wrapper.\n` +
        `Phase 1 (1-10): verify toolchain. Phase 2 (11-25): create metrics.sh. Phase 3 (26-30): output config JSON.\n` +
        `If you are past turn 25, output your structured JSON NOW.`;
    default:
      return `${header}\nCheck: is your core task done? If yes, wrap up and output JSON.`;
  }
}

/**
 * Check whether a resolved file path is inside a given allowed directory.
 */
function isInsideDir(filePath: string, allowedDir: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(allowedDir + path.sep) || resolved === allowedDir;
}

/**
 * Build PreToolUse guard hooks for structural enforcement.
 * Returns undefined if the role has no guards.
 */
function buildPreToolUseGuards(role: string, cwd: string): HookCallbackMatcher[] | undefined {
  if (role === 'compressor') {
    const allowedDir = path.resolve(cwd, 'docs', 'synthesis');
    const guardHook: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const filePath: string = toolInput.file_path ?? '';
      if (filePath && !isInsideDir(filePath, allowedDir)) {
        return {
          decision: 'block' as const,
          reason: `Compressor may only write to docs/synthesis/. Blocked: ${filePath}`,
        };
      }
      return {};
    };

    return [
      { matcher: 'Write', hooks: [guardHook] },
      { matcher: 'Edit', hooks: [guardHook] },
    ];
  }

  if (role === 'diagnostician') {
    const allowedDir = path.resolve(cwd, '.majlis', 'scripts');
    // Write/Edit restricted to .majlis/scripts/ only
    const writeGuard: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const filePath: string = toolInput.file_path ?? '';
      if (filePath && !isInsideDir(filePath, allowedDir)) {
        return {
          decision: 'block' as const,
          reason: `Diagnostician may only write to .majlis/scripts/. Blocked: ${filePath}`,
        };
      }
      return {};
    };

    // Bash: block destructive commands
    const bashGuard: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const command: string = toolInput.command ?? '';
      const destructive = /\b(rm\s+(-\w*[rf]|--recursive|--force)|git\s+(checkout|reset|stash|clean|push\s+--force)|chmod|chown|mkfs|dd\s+if=|sudo\s)/i;
      if (destructive.test(command)) {
        return {
          decision: 'block' as const,
          reason: `Diagnostician blocked destructive command: ${command.slice(0, 100)}`,
        };
      }
      return {};
    };

    return [
      { matcher: 'Write', hooks: [writeGuard] },
      { matcher: 'Edit', hooks: [writeGuard] },
      { matcher: 'Bash', hooks: [bashGuard] },
    ];
  }

  if (role === 'cartographer') {
    const allowedDir = path.resolve(cwd, 'docs', 'synthesis');
    const guardHook: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const filePath: string = toolInput.file_path ?? '';
      if (filePath && !isInsideDir(filePath, allowedDir)) {
        return {
          decision: 'block' as const,
          reason: `Cartographer may only write to docs/synthesis/. Blocked: ${filePath}`,
        };
      }
      return {};
    };

    return [
      { matcher: 'Write', hooks: [guardHook] },
      { matcher: 'Edit', hooks: [guardHook] },
    ];
  }

  if (role === 'toolsmith') {
    const allowedDir = path.resolve(cwd, '.majlis', 'scripts');
    // Write/Edit restricted to .majlis/scripts/ only
    const writeGuard: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const filePath: string = toolInput.file_path ?? '';
      if (filePath && !isInsideDir(filePath, allowedDir)) {
        return {
          decision: 'block' as const,
          reason: `Toolsmith may only write to .majlis/scripts/. Blocked: ${filePath}`,
        };
      }
      return {};
    };

    // Bash: block destructive commands
    const bashGuard: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const command: string = toolInput.command ?? '';
      const destructive = /\b(rm\s+(-\w*[rf]|--recursive|--force)|git\s+(checkout|reset|stash|clean|push\s+--force)|chmod|chown|mkfs|dd\s+if=|sudo\s)/i;
      if (destructive.test(command)) {
        return {
          decision: 'block' as const,
          reason: `Toolsmith blocked destructive command: ${command.slice(0, 100)}`,
        };
      }
      return {};
    };

    return [
      { matcher: 'Write', hooks: [writeGuard] },
      { matcher: 'Edit', hooks: [writeGuard] },
      { matcher: 'Bash', hooks: [bashGuard] },
    ];
  }

  if (role === 'builder') {
    // Block destructive commands
    const bashGuard: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const command: string = toolInput.command ?? '';
      const destructive = /\b(rm\s+(-\w*[rf]|--recursive|--force)|git\s+(checkout|reset|stash|clean|push\s+--force)|chmod|chown|mkfs|dd\s+if=|sudo\s)/i;
      if (destructive.test(command)) {
        return { decision: 'block' as const, reason: `Builder blocked destructive command: ${command.slice(0, 100)}` };
      }
      return {};
    };

    // Block writes to framework config and agent definitions
    // Fix #2: Tradition 12 (Adab al-Bahth) — builder must not modify its own instructions
    const configFile = path.resolve(cwd, '.majlis', 'config.json');
    const dbFile = path.resolve(cwd, '.majlis', 'majlis.db');
    const settingsFile = path.resolve(cwd, '.claude', 'settings.json');
    const claudeDir = path.resolve(cwd, '.claude');
    const agentsDir = path.resolve(cwd, '.majlis', 'agents');
    const configGuard: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const filePath: string = toolInput.file_path ?? '';
      if (filePath) {
        const resolved = path.resolve(filePath);
        if (resolved === configFile || resolved === dbFile || resolved === settingsFile) {
          return { decision: 'block' as const, reason: `Builder may not modify framework files: ${filePath}` };
        }
        if (isInsideDir(resolved, claudeDir) || isInsideDir(resolved, agentsDir)) {
          return { decision: 'block' as const, reason: `Builder may not modify agent definitions or framework settings: ${filePath}` };
        }
      }
      return {};
    };

    return [
      { matcher: 'Bash', hooks: [bashGuard] },
      { matcher: 'Write', hooks: [configGuard] },
      { matcher: 'Edit', hooks: [configGuard] },
    ];
  }

  if (role === 'verifier') {
    // Block writes to framework config and agent definitions
    // Fix #2: Tradition 12 (Adab al-Bahth) — verifier must not modify agent definitions either
    const configFile = path.resolve(cwd, '.majlis', 'config.json');
    const dbFile = path.resolve(cwd, '.majlis', 'majlis.db');
    const settingsFile = path.resolve(cwd, '.claude', 'settings.json');
    const claudeDir = path.resolve(cwd, '.claude');
    const agentsDir = path.resolve(cwd, '.majlis', 'agents');
    const configGuard: HookCallback = async (input) => {
      const toolInput = (input as any).tool_input ?? {};
      const filePath: string = toolInput.file_path ?? '';
      if (filePath) {
        const resolved = path.resolve(filePath);
        if (resolved === configFile || resolved === dbFile || resolved === settingsFile) {
          return { decision: 'block' as const, reason: `Verifier may not modify framework files: ${filePath}` };
        }
        if (isInsideDir(resolved, claudeDir) || isInsideDir(resolved, agentsDir)) {
          return { decision: 'block' as const, reason: `Verifier may not modify agent definitions or framework settings: ${filePath}` };
        }
      }
      return {};
    };

    return [
      { matcher: 'Write', hooks: [configGuard] },
      { matcher: 'Edit', hooks: [configGuard] },
    ];
  }

  return undefined;
}

/**
 * Build agent hooks (PostToolUse checkpoints + PreToolUse guards).
 * Returns undefined if the role has no hooks configured.
 */
function buildAgentHooks(
  role: string,
  maxTurns: number,
  cwd: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  const result: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  let hasHooks = false;

  // PostToolUse: periodic checkpoint grounding reminders
  const interval = CHECKPOINT_INTERVAL[role];
  if (interval) {
    let toolUseCount = 0;
    const checkpointHook: HookCallback = async () => {
      toolUseCount++;
      if (toolUseCount % interval === 0) {
        const msg = buildCheckpointMessage(role, toolUseCount, maxTurns);
        return {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse' as const,
            additionalContext: msg,
          },
        };
      }
      return {};
    };

    result.PostToolUse = [{ hooks: [checkpointHook] }];
    hasHooks = true;
  }

  // PreToolUse: structural guards (e.g. compressor write scope)
  const guards = buildPreToolUseGuards(role, cwd);
  if (guards) {
    result.PreToolUse = guards;
    hasHooks = true;
  }

  return hasHooks ? result : undefined;
}

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
  const contextJson = JSON.stringify(context);
  const prompt = `Here is your context:\n\n\`\`\`json\n${contextJson}\n\`\`\`\n\n${taskPrompt}`;

  const turns = ROLE_MAX_TURNS[role] ?? 15;
  console.log(`[${role}] Spawning (model: ${agentDef.model}, maxTurns: ${turns})...`);

  const { text: markdown, costUsd, truncated } = await runQuery({
    prompt,
    model: agentDef.model,
    tools: agentDef.tools,
    systemPrompt: agentDef.systemPrompt,
    cwd: root,
    maxTurns: turns,
    label: role,
    role,
  });

  console.log(`[${role}] Complete (cost: $${costUsd.toFixed(4)}${truncated ? ', TRUNCATED' : ''})`);

  // Write artifact to docs/ directory
  const artifactPath = writeArtifact(role, context, markdown, root);
  if (artifactPath) {
    console.log(`[${role}] Artifact written to ${artifactPath}`);
  }

  // Extract structured data via 3-tier parsing
  // Fix #4: Tradition 3 (Hadith) — track extraction tier for provenance
  const { data: structured, tier: extractionTier } = await extractStructuredData(role, markdown);

  // Validate role-specific output
  if (structured) {
    const { valid, missing } = validateForRole(role, structured);
    if (!valid) {
      console.warn(`[${role}] Output missing expected fields: ${missing.join(', ')}`);
    }
  }

  if (extractionTier === 3) {
    console.warn(`[${role}] WARNING: Structured output was reconstructed by Haiku (tier 3). Data provenance degraded.`);
  }

  return { output: markdown, structured, truncated, extractionTier };
}

/**
 * Spawn a small synthesiser micro-agent (for resolve step).
 * Not a full role — just a focused Sonnet call.
 *
 * Options:
 *   maxTurns — default 5. Set lower for tool-free planning calls.
 *   tools    — default ['Read', 'Glob', 'Grep']. Pass [] for pure-reasoning calls.
 */
export async function spawnSynthesiser(
  context: AgentContext,
  projectRoot?: string,
  opts?: { maxTurns?: number; tools?: string[] },
): Promise<AgentResult> {
  const root = projectRoot ?? findProjectRoot() ?? process.cwd();
  const maxTurns = opts?.maxTurns ?? 5;
  const tools = opts?.tools ?? ['Read', 'Glob', 'Grep'];

  const contextJson = JSON.stringify(context);
  const taskPrompt = context.taskPrompt ?? 'Synthesise the findings into actionable builder guidance.';
  const prompt = `Here is your context:\n\n\`\`\`json\n${contextJson}\n\`\`\`\n\n${taskPrompt}`;

  const systemPrompt =
    'You are a Synthesis Agent. Be concrete: which decisions failed, which assumptions broke, ' +
    'what constraints must the next approach satisfy. ' +
    'CRITICAL: Your LAST line of output MUST be a <!-- majlis-json --> block. ' +
    'The framework parses this programmatically — if you omit it, the pipeline breaks. ' +
    'Format: <!-- majlis-json {"guidance": "your guidance here"} -->';

  console.log(`[synthesiser] Spawning (maxTurns: ${maxTurns})...`);

  const { text: markdown, costUsd, truncated } = await runQuery({
    prompt,
    model: 'sonnet',
    tools,
    systemPrompt,
    cwd: root,
    maxTurns,
    label: 'synthesiser',
    role: 'synthesiser',
  });

  console.log(`[synthesiser] Complete (cost: $${costUsd.toFixed(4)})`);

  // The synthesiser's output IS the guidance — skip 3-tier extraction
  // (it never outputs <!-- majlis-json --> reliably, wasting a Haiku call).
  return { output: markdown, structured: { guidance: markdown }, truncated, extractionTier: null };
}

/**
 * Spawn a recovery agent to clean up after a truncated agent run.
 * Reads the partial output, the experiment doc, and writes a clean
 * experiment doc with whatever is salvageable. Minimal turns, Haiku model.
 */
export async function spawnRecovery(
  role: string,
  partialOutput: string,
  context: AgentContext,
  projectRoot?: string,
): Promise<void> {
  const root = projectRoot ?? findProjectRoot() ?? process.cwd();
  const expSlug = context.experiment?.slug ?? 'unknown';

  console.log(`[recovery] Cleaning up after truncated ${role} for ${expSlug}...`);

  const expDocPath = path.join(root, 'docs', 'experiments',
    `${String(context.experiment?.id ?? 0).padStart(3, '0')}-${expSlug}.md`);

  // Read the experiment doc template for structure reference
  const templatePath = path.join(root, 'docs', 'experiments', '_TEMPLATE.md');
  const template = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf-8') : '';

  // Read the current experiment doc (may have been partially edited by truncated agent)
  const currentDoc = fs.existsSync(expDocPath) ? fs.readFileSync(expDocPath, 'utf-8') : '';

  const prompt = `The ${role} agent was truncated (hit max turns) while working on experiment "${expSlug}".

Here is the partial agent output (reasoning + tool calls):
<partial_output>
${partialOutput.slice(-3000)}
</partial_output>

Here is the current experiment doc:
<current_doc>
${currentDoc}
</current_doc>

Here is the template that the experiment doc should follow:
<template>
${template}
</template>

Your job: Write a CLEAN experiment doc to ${expDocPath} using the Write tool.
- Keep any valid content from the current doc
- Fill in what you can infer from the partial output
- Mark incomplete sections with "[TRUNCATED — ${role} did not finish]"
- The doc MUST have the <!-- majlis-json --> block, even if decisions are empty
- Do NOT include agent reasoning or thinking — only structured experiment content
- Be concise. This is cleanup, not new work.`;

  const { text: _markdown } = await runQuery({
    prompt,
    model: 'haiku',
    tools: ['Read', 'Write'],
    systemPrompt: `You are a Recovery Agent. You clean up experiment docs after truncated agent runs. Write clean, structured docs. Never include agent reasoning or monologue.`,
    cwd: root,
    maxTurns: 5,
    label: 'recovery',
    role: 'recovery',
  });

  console.log(`[recovery] Cleanup complete for ${expSlug}.`);
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
  role?: string;
}): Promise<{ text: string; costUsd: number; truncated: boolean }> {
  let truncated = false;
  const tag = opts.label ?? 'majlis';
  const hooks = opts.role ? buildAgentHooks(opts.role, opts.maxTurns ?? 15, opts.cwd) : undefined;
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
      hooks,
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
        // Agent hit turn limit — flag as truncated so the cycle can handle gracefully.
        truncated = true;
        costUsd = 'total_cost_usd' in message ? (message as any).total_cost_usd : 0;
        console.warn(`[${tag}] Hit max turns (${turnCount}). Returning partial output.`);
      } else {
        const errors = 'errors' in message ? (message.errors?.join('; ') ?? 'Unknown error') : 'Unknown error';
        throw new Error(`Agent query failed (${message.subtype}): ${errors}`);
      }
    }
  }

  return { text: textParts.join('\n\n'), costUsd, truncated };
}

/**
 * Generate a concise 2-4 word slug from a hypothesis using Haiku.
 * Falls back to naive truncation on failure.
 */
export async function generateSlug(hypothesis: string, projectRoot: string): Promise<string> {
  const fallback = hypothesis
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .replace(/-$/, '');

  try {
    const { text } = await runQuery({
      prompt:
        `Generate a short, descriptive git branch slug (2-4 words, lowercase, hyphen-separated) for this experiment hypothesis:\n\n"${hypothesis.slice(0, 500)}"\n\n` +
        `Output ONLY the slug, nothing else. Examples: uv-containment-filter, skip-degenerate-faces, fix-edge-sewing-order`,
      model: 'haiku',
      tools: [],
      systemPrompt: 'Output only a short hyphenated slug. No explanation, no quotes, no punctuation except hyphens.',
      cwd: projectRoot,
      maxTurns: 1,
      label: 'slug',
      role: 'slug',
    });

    const slug = text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    return slug.length >= 3 ? slug : fallback;
  } catch {
    return fallback;
  }
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

  // Builder and compressor manage their own files via Write/Edit tool calls.
  // Writing the raw agent output here would OVERWRITE their clean docs with
  // the full monologue (all reasoning text between tool calls).
  if (role === 'builder' || role === 'compressor' || role === 'diagnostician' || role === 'cartographer' || role === 'toolsmith') return null;

  const fullDir = path.join(projectRoot, dir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  // Create a numbered file for critic, adversary, verifier, reframer, scout
  const expSlug = context.experiment?.slug ?? 'general';
  const nextNum = String(context.experiment?.id ?? 1).padStart(3, '0');
  const filename = `${nextNum}-${role}-${expSlug}.md`;

  const target = path.join(fullDir, filename);
  fs.writeFileSync(target, markdown);
  return target;
}
