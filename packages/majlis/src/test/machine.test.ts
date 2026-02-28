import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ExperimentStatus, TRANSITIONS, GRADE_ORDER } from '../state/types.js';
import { transition, validNext, isTerminal, determineNextStep } from '../state/machine.js';
import type { Experiment } from '../types.js';

function makeExp(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 1,
    slug: 'test-exp',
    branch: 'exp/001-test-exp',
    status: 'classified',
    classification_ref: null,
    sub_type: null,
    hypothesis: 'Test hypothesis',
    builder_guidance: null,
    depends_on: null,
    context_files: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

describe('ExperimentStatus enum', () => {
  it('has 14 states', () => {
    const values = Object.values(ExperimentStatus);
    assert.equal(values.length, 14);
  });

  it('has exactly the states from PRD v2 §4.1 + GATED', () => {
    const expected = [
      'classified', 'reframed', 'gated', 'building', 'built', 'challenged',
      'doubted', 'scouted', 'verifying', 'verified', 'resolved',
      'compressed', 'merged', 'dead_end',
    ];
    for (const s of expected) {
      assert.ok(Object.values(ExperimentStatus).includes(s as ExperimentStatus), `Missing: ${s}`);
    }
  });
});

describe('TRANSITIONS map', () => {
  it('covers every status', () => {
    for (const status of Object.values(ExperimentStatus)) {
      assert.ok(status in TRANSITIONS, `Missing transitions for: ${status}`);
    }
  });

  it('terminal states have no transitions', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.MERGED], []);
    assert.deepEqual(TRANSITIONS[ExperimentStatus.DEAD_END], []);
  });

  it('classified can go to reframed or gated', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.CLASSIFIED], [
      ExperimentStatus.REFRAMED, ExperimentStatus.GATED,
    ]);
  });

  it('reframed goes to gated', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.REFRAMED], [
      ExperimentStatus.GATED,
    ]);
  });

  it('gated can go to building or self-loop', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.GATED], [
      ExperimentStatus.BUILDING, ExperimentStatus.GATED,
    ]);
  });

  it('built must go through challenge or doubt', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.BUILT], [
      ExperimentStatus.CHALLENGED, ExperimentStatus.DOUBTED,
    ]);
  });

  it('resolved can go to compressed, building, merged, or dead_end', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.RESOLVED], [
      ExperimentStatus.COMPRESSED, ExperimentStatus.BUILDING,
      ExperimentStatus.MERGED, ExperimentStatus.DEAD_END,
    ]);
  });

  it('compressed can go to merged or building (cycle back skips gate)', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.COMPRESSED], [
      ExperimentStatus.MERGED, ExperimentStatus.BUILDING,
    ]);
  });
});

describe('transition()', () => {
  it('returns the target for valid transitions', () => {
    assert.equal(
      transition(ExperimentStatus.CLASSIFIED, ExperimentStatus.GATED),
      ExperimentStatus.GATED,
    );
    assert.equal(
      transition(ExperimentStatus.GATED, ExperimentStatus.BUILDING),
      ExperimentStatus.BUILDING,
    );
    assert.equal(
      transition(ExperimentStatus.BUILT, ExperimentStatus.DOUBTED),
      ExperimentStatus.DOUBTED,
    );
    assert.equal(
      transition(ExperimentStatus.VERIFIED, ExperimentStatus.RESOLVED),
      ExperimentStatus.RESOLVED,
    );
  });

  it('throws on invalid transitions', () => {
    assert.throws(
      () => transition(ExperimentStatus.CLASSIFIED, ExperimentStatus.VERIFIED),
      /Invalid transition/,
    );
    assert.throws(
      () => transition(ExperimentStatus.MERGED, ExperimentStatus.BUILDING),
      /Invalid transition/,
    );
    assert.throws(
      () => transition(ExperimentStatus.BUILT, ExperimentStatus.MERGED),
      /Invalid transition/,
    );
    // classified → building is no longer valid (must go through gate)
    assert.throws(
      () => transition(ExperimentStatus.CLASSIFIED, ExperimentStatus.BUILDING),
      /Invalid transition/,
    );
  });

  it('throws on self-transitions that are not in the map', () => {
    assert.throws(
      () => transition(ExperimentStatus.BUILT, ExperimentStatus.BUILT),
      /Invalid transition/,
    );
  });

  it('allows building → building self-loop for truncation retry', () => {
    assert.equal(transition(ExperimentStatus.BUILDING, ExperimentStatus.BUILDING), ExperimentStatus.BUILDING);
  });

  it('allows gated → gated self-loop for rejected hypotheses', () => {
    assert.equal(transition(ExperimentStatus.GATED, ExperimentStatus.GATED), ExperimentStatus.GATED);
  });
});

describe('validNext()', () => {
  it('returns valid transitions for each status', () => {
    assert.deepEqual(validNext(ExperimentStatus.REFRAMED), [ExperimentStatus.GATED]);
    assert.deepEqual(validNext(ExperimentStatus.GATED), [ExperimentStatus.BUILDING, ExperimentStatus.GATED]);
    assert.deepEqual(validNext(ExperimentStatus.SCOUTED), [ExperimentStatus.VERIFYING]);
    assert.deepEqual(validNext(ExperimentStatus.MERGED), []);
  });
});

describe('isTerminal()', () => {
  it('merged is terminal', () => {
    assert.ok(isTerminal(ExperimentStatus.MERGED));
  });

  it('dead_end is terminal', () => {
    assert.ok(isTerminal(ExperimentStatus.DEAD_END));
  });

  it('classified is not terminal', () => {
    assert.ok(!isTerminal(ExperimentStatus.CLASSIFIED));
  });

  it('building is not terminal', () => {
    assert.ok(!isTerminal(ExperimentStatus.BUILDING));
  });

  it('verified is not terminal', () => {
    assert.ok(!isTerminal(ExperimentStatus.VERIFIED));
  });

  it('gated is not terminal', () => {
    assert.ok(!isTerminal(ExperimentStatus.GATED));
  });
});

describe('determineNextStep()', () => {
  it('built + no doubts → doubted', () => {
    const exp = makeExp({ status: 'built' });
    const valid = TRANSITIONS[ExperimentStatus.BUILT];
    const result = determineNextStep(exp, valid, false, false);
    assert.equal(result, ExperimentStatus.DOUBTED);
  });

  it('built + has doubts → first valid (challenged)', () => {
    const exp = makeExp({ status: 'built' });
    const valid = TRANSITIONS[ExperimentStatus.BUILT];
    const result = determineNextStep(exp, valid, true, false);
    assert.equal(result, ExperimentStatus.CHALLENGED);
  });

  it('doubted + no challenges → challenged', () => {
    const exp = makeExp({ status: 'doubted' });
    const valid = TRANSITIONS[ExperimentStatus.DOUBTED];
    const result = determineNextStep(exp, valid, true, false);
    assert.equal(result, ExperimentStatus.CHALLENGED);
  });

  it('doubted + has challenges → verifying', () => {
    const exp = makeExp({ status: 'doubted' });
    const valid = TRANSITIONS[ExperimentStatus.DOUBTED];
    const result = determineNextStep(exp, valid, true, true);
    assert.equal(result, ExperimentStatus.VERIFYING);
  });

  it('challenged → verifying', () => {
    const exp = makeExp({ status: 'challenged' });
    const valid = TRANSITIONS[ExperimentStatus.CHALLENGED];
    const result = determineNextStep(exp, valid, true, true);
    assert.equal(result, ExperimentStatus.VERIFYING);
  });

  it('classified → gated (must gate before building)', () => {
    const exp = makeExp({ status: 'classified' });
    const valid = TRANSITIONS[ExperimentStatus.CLASSIFIED];
    const result = determineNextStep(exp, valid, false, false);
    assert.equal(result, ExperimentStatus.GATED);
  });

  it('reframed → gated', () => {
    const exp = makeExp({ status: 'reframed' });
    const valid = TRANSITIONS[ExperimentStatus.REFRAMED];
    const result = determineNextStep(exp, valid, false, false);
    assert.equal(result, ExperimentStatus.GATED);
  });

  it('gated → building', () => {
    const exp = makeExp({ status: 'gated' });
    const valid = TRANSITIONS[ExperimentStatus.GATED];
    const result = determineNextStep(exp, valid, false, false);
    assert.equal(result, ExperimentStatus.BUILDING);
  });

  it('throws on terminal states', () => {
    const exp = makeExp({ status: 'merged' });
    assert.throws(
      () => determineNextStep(exp, [], false, false),
      /terminal/,
    );
  });
});

describe('GRADE_ORDER', () => {
  it('is ordered worst to best', () => {
    assert.deepEqual(GRADE_ORDER, ['rejected', 'weak', 'good', 'sound']);
  });
});
