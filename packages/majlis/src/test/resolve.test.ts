import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { worstGrade, accumulateGuidance, parseSynthesiserDeadApproaches } from '../resolve.js';
import type { Verification } from '../types.js';

function makeVerification(grade: string, component: string = 'test'): Verification {
  return {
    id: 1,
    experiment_id: 1,
    component,
    grade,
    provenance_intact: 1,
    content_correct: 1,
    notes: null,
    created_at: '2024-01-01',
  };
}

describe('worstGrade()', () => {
  it('returns sound when all grades are sound', () => {
    const grades = [
      makeVerification('sound', 'comp1'),
      makeVerification('sound', 'comp2'),
      makeVerification('sound', 'comp3'),
    ];
    assert.equal(worstGrade(grades), 'sound');
  });

  it('returns good when worst is good', () => {
    const grades = [
      makeVerification('sound', 'comp1'),
      makeVerification('good', 'comp2'),
      makeVerification('sound', 'comp3'),
    ];
    assert.equal(worstGrade(grades), 'good');
  });

  it('returns weak when any component is weak', () => {
    const grades = [
      makeVerification('sound', 'comp1'),
      makeVerification('weak', 'comp2'),
      makeVerification('good', 'comp3'),
    ];
    assert.equal(worstGrade(grades), 'weak');
  });

  it('returns rejected when any component is rejected', () => {
    const grades = [
      makeVerification('sound', 'comp1'),
      makeVerification('rejected', 'comp2'),
      makeVerification('weak', 'comp3'),
    ];
    assert.equal(worstGrade(grades), 'rejected');
  });

  it('rejected beats everything', () => {
    const grades = [
      makeVerification('rejected', 'comp1'),
      makeVerification('sound', 'comp2'),
    ];
    assert.equal(worstGrade(grades), 'rejected');
  });

  it('throws for empty grades array', () => {
    assert.throws(() => worstGrade([]), /Cannot determine grade from empty verification set/);
  });

  it('handles single grade', () => {
    assert.equal(worstGrade([makeVerification('weak')]), 'weak');
    assert.equal(worstGrade([makeVerification('good')]), 'good');
  });
});

describe('accumulateGuidance()', () => {
  it('creates first iteration from null', () => {
    const result = accumulateGuidance(null, 'Fix the retry logic');
    assert.ok(result.includes('### Iteration 1 (latest)'));
    assert.ok(result.includes('Fix the retry logic'));
  });

  it('accumulates second iteration with separator', () => {
    const first = accumulateGuidance(null, 'First attempt failed');
    const second = accumulateGuidance(first, 'Second attempt guidance');
    assert.ok(second.includes('### Iteration 2 (latest)'));
    assert.ok(second.includes('Second attempt guidance'));
    assert.ok(second.includes('### Iteration 1'));
    assert.ok(second.includes('First attempt failed'));
    // Only latest iteration has "(latest)" marker
    assert.equal((second.match(/\(latest\)/g) ?? []).length, 1);
  });

  it('accumulates three iterations in order', () => {
    let guidance = accumulateGuidance(null, 'Guidance 1');
    guidance = accumulateGuidance(guidance, 'Guidance 2');
    guidance = accumulateGuidance(guidance, 'Guidance 3');
    assert.ok(guidance.includes('### Iteration 3 (latest)'));
    assert.ok(guidance.includes('### Iteration 2'));
    assert.ok(guidance.includes('### Iteration 1'));
    // Newest first
    assert.ok(guidance.indexOf('Iteration 3') < guidance.indexOf('Iteration 2'));
    assert.ok(guidance.indexOf('Iteration 2') < guidance.indexOf('Iteration 1'));
  });

  it('truncates oldest iterations when over limit', () => {
    // Build up many iterations with large content
    let guidance: string | null = null;
    for (let i = 0; i < 20; i++) {
      guidance = accumulateGuidance(guidance, `Iteration ${i + 1} content: ${'x'.repeat(1000)}`);
    }
    assert.ok(guidance!.length <= 13_000); // 12K + slack for truncation marker
    // Iteration numbering is monotonic even after truncation
    assert.ok(guidance!.includes('### Iteration 20 (latest)'));
    assert.ok(guidance!.includes('[Earlier iterations truncated]'));
    // Latest content is preserved, oldest is dropped
    assert.ok(guidance!.includes('Iteration 20 content'));
    assert.ok(!guidance!.includes('Iteration 1 content'));
  });

  it('preserves all content when under limit', () => {
    let guidance = accumulateGuidance(null, 'Short guidance 1');
    guidance = accumulateGuidance(guidance, 'Short guidance 2');
    assert.ok(!guidance.includes('[Earlier iterations truncated]'));
    assert.ok(guidance.includes('Short guidance 1'));
    assert.ok(guidance.includes('Short guidance 2'));
  });
});

describe('parseSynthesiserDeadApproaches()', () => {
  it('extracts single dead approach', () => {
    const output = `Some analysis here.\n\n[DEAD-APPROACH] vertex-normal fitting: normals are undefined at edges\n\nMore text.`;
    const results = parseSynthesiserDeadApproaches(output);
    assert.equal(results.length, 1);
    assert.equal(results[0].approach, 'vertex-normal fitting');
    assert.equal(results[0].reason, 'normals are undefined at edges');
  });

  it('extracts multiple dead approaches', () => {
    const output = `
[DEAD-APPROACH] approach A: reason A
Some text in between.
[DEAD-APPROACH] approach B: reason B
`;
    const results = parseSynthesiserDeadApproaches(output);
    assert.equal(results.length, 2);
    assert.equal(results[0].approach, 'approach A');
    assert.equal(results[1].approach, 'approach B');
  });

  it('returns empty array when no markers present', () => {
    const output = 'Just regular synthesis text with no dead approach markers.';
    const results = parseSynthesiserDeadApproaches(output);
    assert.equal(results.length, 0);
  });

  it('handles approach names with spaces and hyphens', () => {
    const output = '[DEAD-APPROACH] recursive curvature-split method: causes false positives on sparse data';
    const results = parseSynthesiserDeadApproaches(output);
    assert.equal(results.length, 1);
    assert.equal(results[0].approach, 'recursive curvature-split method');
  });
});
