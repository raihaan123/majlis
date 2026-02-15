import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { worstGrade } from '../resolve.js';
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

  it('returns sound for empty grades array', () => {
    assert.equal(worstGrade([]), 'sound');
  });

  it('handles single grade', () => {
    assert.equal(worstGrade([makeVerification('weak')]), 'weak');
    assert.equal(worstGrade([makeVerification('good')]), 'good');
  });
});
