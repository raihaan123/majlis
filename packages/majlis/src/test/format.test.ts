import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  stripAnsi,
  bold, dim, red, green, yellow, blue, cyan,
  table, statusColor, gradeColor, evidenceColor,
  error, warn, info, success, header,
} from '../output/format.js';

describe('stripAnsi()', () => {
  it('removes ANSI color codes', () => {
    assert.equal(stripAnsi('\x1b[31mhello\x1b[0m'), 'hello');
  });

  it('removes multiple ANSI codes', () => {
    assert.equal(stripAnsi('\x1b[1m\x1b[36mfoo\x1b[0m bar \x1b[33mbaz\x1b[0m'), 'foo bar baz');
  });

  it('preserves plain text', () => {
    assert.equal(stripAnsi('no ansi here'), 'no ansi here');
  });

  it('handles empty string', () => {
    assert.equal(stripAnsi(''), '');
  });

  it('removes dim and bold codes', () => {
    assert.equal(stripAnsi('\x1b[1mbold\x1b[0m \x1b[2mdim\x1b[0m'), 'bold dim');
  });
});

describe('color functions', () => {
  it('bold wraps text', () => {
    const result = bold('test');
    assert.equal(stripAnsi(result), 'test');
  });

  it('all color functions return text that stripAnsi can clean', () => {
    const fns = [bold, dim, red, green, yellow, blue, cyan];
    for (const fn of fns) {
      assert.equal(stripAnsi(fn('x')), 'x', `${fn.name} should wrap cleanly`);
    }
  });
});

describe('statusColor()', () => {
  it('returns colored text for known statuses', () => {
    const statuses = ['merged', 'dead_end', 'building', 'built', 'verifying', 'verified', 'classified', 'reframed', 'gated'];
    for (const s of statuses) {
      assert.equal(stripAnsi(statusColor(s)), s);
    }
  });
});

describe('gradeColor()', () => {
  it('returns colored text for known grades', () => {
    const grades = ['sound', 'good', 'weak', 'rejected'];
    for (const g of grades) {
      assert.equal(stripAnsi(gradeColor(g)), g);
    }
  });

  it('returns plain text for unknown grade', () => {
    assert.equal(gradeColor('unknown'), 'unknown');
  });
});

describe('evidenceColor()', () => {
  it('returns colored text for known levels', () => {
    const levels = ['proof', 'test', 'strong_consensus', 'consensus', 'analogy', 'judgment'];
    for (const l of levels) {
      assert.equal(stripAnsi(evidenceColor(l)), l);
    }
  });
});

describe('table()', () => {
  it('aligns columns correctly', () => {
    const result = table(
      ['Name', 'Status'],
      [['alpha', 'ok'], ['beta-long', 'fail']],
    );
    const lines = result.split('\n');
    // Header, separator, 2 data rows
    assert.equal(lines.length, 4);
  });

  it('handles ANSI-colored cells without misalignment', () => {
    const result = table(
      ['Name', 'Grade'],
      [['exp-1', green('sound')], ['exp-2', red('rejected')]],
    );
    const lines = result.split('\n');
    // Strip ANSI from each data row — columns should still be aligned
    const row1Stripped = stripAnsi(lines[2]);
    const row2Stripped = stripAnsi(lines[3]);
    // Both rows should have the same visual width pattern
    // 'sound' and 'rejected' have different lengths, but the first column should align
    const col1End1 = row1Stripped.indexOf('sound');
    const col1End2 = row2Stripped.indexOf('rejected');
    assert.equal(col1End1, col1End2, 'second column should start at same position');
  });

  it('handles empty rows', () => {
    const result = table(['A', 'B'], []);
    const lines = result.split('\n');
    assert.equal(lines.length, 2); // header + separator only
  });
});

describe('output functions exist', () => {
  it('error is a function', () => {
    assert.equal(typeof error, 'function');
  });

  it('warn is a function', () => {
    assert.equal(typeof warn, 'function');
  });

  it('info is a function', () => {
    assert.equal(typeof info, 'function');
  });

  it('success is a function', () => {
    assert.equal(typeof success, 'function');
  });

  it('header is a function', () => {
    assert.equal(typeof header, 'function');
  });
});
