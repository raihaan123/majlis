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
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

describe('ExperimentStatus enum', () => {
  it('has 13 states', () => {
    const values = Object.values(ExperimentStatus);
    assert.equal(values.length, 13);
  });

  it('has exactly the states from PRD v2 §4.1', () => {
    const expected = [
      'classified', 'reframed', 'building', 'built', 'challenged',
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

  it('classified can go to reframed or building', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.CLASSIFIED], [
      ExperimentStatus.REFRAMED, ExperimentStatus.BUILDING,
    ]);
  });

  it('built must go through challenge or doubt', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.BUILT], [
      ExperimentStatus.CHALLENGED, ExperimentStatus.DOUBTED,
    ]);
  });

  it('resolved can go to compressed or building (cycle back)', () => {
    assert.deepEqual(TRANSITIONS[ExperimentStatus.RESOLVED], [
      ExperimentStatus.COMPRESSED, ExperimentStatus.BUILDING,
    ]);
  });
});

describe('transition()', () => {
  it('returns the target for valid transitions', () => {
    assert.equal(
      transition(ExperimentStatus.CLASSIFIED, ExperimentStatus.BUILDING),
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
  });

  it('throws on self-transitions that are not in the map', () => {
    assert.throws(
      () => transition(ExperimentStatus.BUILDING, ExperimentStatus.BUILDING),
      /Invalid transition/,
    );
  });
});

describe('validNext()', () => {
  it('returns valid transitions for each status', () => {
    assert.deepEqual(validNext(ExperimentStatus.REFRAMED), [ExperimentStatus.BUILDING]);
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

  it('classified → building (skip reframe, already session-level)', () => {
    const exp = makeExp({ status: 'classified' });
    const valid = TRANSITIONS[ExperimentStatus.CLASSIFIED];
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
