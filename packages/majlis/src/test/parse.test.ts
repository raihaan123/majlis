import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractMajlisJsonBlock, tryParseJson, extractViaPatterns } from '../agents/parse.js';

describe('Tier 1: extractMajlisJsonBlock()', () => {
  it('extracts JSON from a well-formed <!-- majlis-json --> block', () => {
    const markdown = `# Experiment Report

Some text here.

<!-- majlis-json
{
  "decisions": [
    { "description": "Use strategy 2", "evidence_level": "judgment", "justification": "Best approach" }
  ]
}
-->

More text.`;

    const result = extractMajlisJsonBlock(markdown);
    assert.ok(result);
    const parsed = JSON.parse(result);
    assert.equal(parsed.decisions.length, 1);
    assert.equal(parsed.decisions[0].evidence_level, 'judgment');
  });

  it('returns null when no block exists', () => {
    const markdown = '# Just a heading\n\nSome text.';
    assert.equal(extractMajlisJsonBlock(markdown), null);
  });

  it('handles block with extra whitespace', () => {
    const markdown = `<!--   majlis-json
{
  "grades": [{ "component": "test", "grade": "sound" }]
}
-->`;
    const result = extractMajlisJsonBlock(markdown);
    assert.ok(result);
    const parsed = JSON.parse(result);
    assert.equal(parsed.grades[0].grade, 'sound');
  });
});

describe('tryParseJson()', () => {
  it('parses valid JSON', () => {
    const result = tryParseJson('{"decisions": []}');
    assert.deepEqual(result, { decisions: [] });
  });

  it('returns null for invalid JSON', () => {
    assert.equal(tryParseJson('not json'), null);
    assert.equal(tryParseJson('{broken'), null);
    assert.equal(tryParseJson(''), null);
  });
});

describe('Tier 2: extractViaPatterns()', () => {
  it('extracts inline evidence level tags', () => {
    const markdown = `
## Decisions
[judgment] Use parametric seam splitting for periodic surfaces
[test] Validated edge merging with ubracket fixture
[analogy] Apply cylinder strategy from EXP-003
`;
    const result = extractViaPatterns('builder', markdown);
    assert.ok(result?.decisions);
    assert.equal(result.decisions.length, 3);
    assert.equal(result.decisions[0].evidence_level, 'judgment');
    assert.equal(result.decisions[1].evidence_level, 'test');
    assert.equal(result.decisions[2].evidence_level, 'analogy');
  });

  it('extracts grade patterns', () => {
    const markdown = `
## Verification
- cylinder_builder: sound
- seam_handler: weak
- face_validator: good
- edge_merger: rejected
`;
    const result = extractViaPatterns('verifier', markdown);
    assert.ok(result?.grades);
    assert.equal(result.grades.length, 4);
    assert.equal(result.grades.find(g => g.component === 'cylinder_builder')?.grade, 'sound');
    assert.equal(result.grades.find(g => g.component === 'seam_handler')?.grade, 'weak');
    assert.equal(result.grades.find(g => g.component === 'edge_merger')?.grade, 'rejected');
  });

  it('extracts doubt patterns with severity', () => {
    const markdown = `
## Doubts

Doubt 1: Tolerance assumption
The approach assumes vertex proximity.
Severity: moderate

Doubt 2: Untested topology
No tests for star junctions.
Severity: critical
`;
    const result = extractViaPatterns('critic', markdown);
    assert.ok(result?.doubts);
    assert.equal(result.doubts.length, 2);
    assert.equal(result.doubts[0].severity, 'moderate');
    assert.equal(result.doubts[1].severity, 'critical');
  });

  it('returns empty result for unstructured text', () => {
    const markdown = 'Just a plain paragraph with no structured markers.';
    const result = extractViaPatterns('builder', markdown);
    // Should return an object but with no data arrays
    assert.ok(result);
  });
});
