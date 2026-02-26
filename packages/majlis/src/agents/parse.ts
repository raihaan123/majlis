import type { StructuredOutput } from './types.js';
import { EXTRACTION_SCHEMA, getExtractionSchema, ROLE_REQUIRED_FIELDS } from './types.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

/**
 * 3-tier extraction strategy for structured data from agent output.
 * PRD v2 §4.6 + §9.2.
 *
 * LLMs are unreliable at JSON formatting under complex reasoning load.
 * Never fail silently — warn loudly, degrade gracefully.
 */
export async function extractStructuredData(
  role: string,
  markdown: string,
): Promise<StructuredOutput | null> {
  // Tier 1: Parse <!-- majlis-json --> block
  const tier1 = extractMajlisJsonBlock(markdown);
  if (tier1) {
    const parsed = tryParseJson(tier1);
    if (parsed) return parsed;
    console.warn(`[majlis] Malformed JSON in <!-- majlis-json --> block for ${role}. Falling back.`);
  } else {
    console.warn(`[majlis] No <!-- majlis-json --> block found in ${role} output. Falling back.`);
  }

  // Tier 2: Regex extraction from markdown prose
  const tier2 = extractViaPatterns(role, markdown);
  if (tier2 && hasData(tier2)) {
    console.warn(`[majlis] Used regex fallback for ${role}. Review extracted data.`);
    return tier2;
  }

  // Tier 3: Haiku post-processing
  console.warn(`[majlis] Regex fallback insufficient for ${role}. Using Haiku extraction.`);
  const tier3 = await extractViaHaiku(role, markdown);
  if (tier3) return tier3;

  // All tiers failed
  console.error(
    `[majlis] FAILED to extract structured data from ${role} output. ` +
    `State machine will continue but data is missing. Manual review required.`
  );
  return null;
}

/**
 * Tier 1: Extract <!-- majlis-json ... --> block from markdown.
 */
export function extractMajlisJsonBlock(markdown: string): string | null {
  const match = markdown.match(/<!--\s*majlis-json\s*\n?([\s\S]*?)-->/);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Try to parse a JSON string, returning null on failure.
 */
export function tryParseJson(jsonStr: string): StructuredOutput | null {
  try {
    return JSON.parse(jsonStr) as StructuredOutput;
  } catch {
    return null;
  }
}

/**
 * Tier 2: Regex patterns for evidence levels, grades, severity, doubts.
 */
export function extractViaPatterns(role: string, markdown: string): StructuredOutput | null {
  const result: StructuredOutput = {};

  // Extract evidence level tags: [judgment], [test], [proof], etc.
  const decisionPattern = /\[(?:decision|Decision)\].*?(?:description|Description):\s*(.+?)(?:\n|$).*?(?:evidence.?level|Evidence.?Level|level):\s*(proof|test|strong_consensus|consensus|analogy|judgment).*?(?:justification|Justification):\s*(.+?)(?:\n|$)/gis;
  const decisions: StructuredOutput['decisions'] = [];

  // Simpler pattern: look for evidence level markers in context
  const evidenceMarkers = /(?:^|\n)\s*[-*]\s*\*?\*?(?:Decision|DECISION)\*?\*?:\s*(.+?)(?:\n|$).*?(?:Evidence|EVIDENCE|Level):\s*(proof|test|strong_consensus|consensus|analogy|judgment)/gim;
  let match;
  while ((match = evidenceMarkers.exec(markdown)) !== null) {
    decisions.push({
      description: match[1].trim(),
      evidence_level: match[2].toLowerCase().trim(),
      justification: 'Extracted via regex — review',
    });
  }

  // Also look for inline tags like [judgment] or [test] before decisions
  const inlineTagPattern = /\[(proof|test|strong_consensus|consensus|analogy|judgment)\]\s*(.+?)(?:\n|$)/gi;
  while ((match = inlineTagPattern.exec(markdown)) !== null) {
    // Avoid duplicating decisions we already found
    const desc = match[2].trim();
    if (!decisions.some(d => d.description === desc)) {
      decisions.push({
        description: desc,
        evidence_level: match[1].toLowerCase(),
        justification: 'Extracted via regex — review',
      });
    }
  }
  if (decisions.length > 0) result.decisions = decisions;

  // Extract grades: "Grade: sound", "grade: weak", etc.
  const grades: StructuredOutput['grades'] = [];
  const gradePattern = /(?:^|\n)\s*[-*]?\s*\*?\*?(?:Grade|GRADE|Component)\*?\*?.*?(?:component|Component)?\s*[:=]\s*(.+?)(?:\n|,).*?(?:grade|Grade)\s*[:=]\s*(sound|good|weak|rejected)/gim;
  while ((match = gradePattern.exec(markdown)) !== null) {
    grades.push({
      component: match[1].trim(),
      grade: match[2].toLowerCase().trim(),
    });
  }

  // Simpler grade pattern: "X: sound/good/weak/rejected"
  const simpleGradePattern = /(?:^|\n)\s*[-*]\s*\*?\*?(.+?)\*?\*?\s*[:—–-]\s*\*?\*?(sound|good|weak|rejected)\*?\*?/gim;
  while ((match = simpleGradePattern.exec(markdown)) !== null) {
    const comp = match[1].trim();
    if (!grades.some(g => g.component === comp)) {
      grades.push({
        component: comp,
        grade: match[2].toLowerCase().trim(),
      });
    }
  }
  if (grades.length > 0) result.grades = grades;

  // Extract doubts with severity
  const doubts: StructuredOutput['doubts'] = [];
  const doubtPattern = /(?:Doubt|DOUBT|Claim doubted|CLAIM)\s*(?:\d+)?[:.]?\s*(.+?)(?:\n|$)[\s\S]*?(?:Severity|SEVERITY)\s*[:=]\s*(minor|moderate|critical)/gim;
  while ((match = doubtPattern.exec(markdown)) !== null) {
    doubts.push({
      claim_doubted: match[1].trim(),
      evidence_level_of_claim: 'unknown',  // Don't fabricate — mark as unknown for review
      evidence_for_doubt: 'Extracted via regex — review original document',
      severity: match[2].toLowerCase().trim(),
    });
  }
  if (doubts.length > 0) result.doubts = doubts;

  return result;
}

/**
 * Tier 3: Haiku post-processing — cheap focused LLM call via Agent SDK.
 */
async function extractViaHaiku(role: string, markdown: string): Promise<StructuredOutput | null> {
  try {
    const truncated = markdown.length > 8000 ? markdown.slice(0, 8000) + '\n[truncated]' : markdown;

    const schema = getExtractionSchema(role);
    const prompt = `Extract structured data from this ${role} document as JSON. Follow this schema exactly: ${schema}\n\nDocument:\n${truncated}`;

    const conversation = query({
      prompt,
      options: {
        model: 'haiku',
        tools: [],
        systemPrompt: 'You are a JSON extraction assistant. Output only valid JSON matching the requested schema. No markdown, no explanation, just JSON.',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        persistSession: false,
      },
    });

    let resultText = '';
    for await (const message of conversation) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            resultText += block.text;
          }
        }
      }
    }

    return tryParseJson(resultText.trim());
  } catch (err) {
    console.warn(`[majlis] Haiku extraction failed for ${role}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function hasData(output: StructuredOutput): boolean {
  return !!(
    (output.decisions && output.decisions.length > 0) ||
    (output.grades && output.grades.length > 0) ||
    (output.doubts && output.doubts.length > 0) ||
    (output.challenges && output.challenges.length > 0) ||
    (output.findings && output.findings.length > 0) ||
    output.guidance ||
    output.reframe ||
    output.compression_report ||
    output.gate_decision ||
    output.diagnosis
  );
}

/**
 * Validate that structured output contains the expected fields for the role.
 */
export function validateForRole(
  role: string,
  output: StructuredOutput,
): { valid: boolean; missing: string[] } {
  const required = ROLE_REQUIRED_FIELDS[role];
  if (!required) return { valid: true, missing: [] };

  const missing = required.filter(field => {
    const value = (output as any)[field];
    if (value === undefined || value === null) return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  });

  return { valid: missing.length === 0, missing };
}
