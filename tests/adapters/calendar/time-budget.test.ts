import { describe, expect, it } from 'vitest';
import { runWithBudget, TimeBudgetExceeded } from '../../../src/adapters/calendar/time-budget';

describe('runWithBudget', () => {
  it('returns the task result and rethrows task errors untouched', () => {
    const failure = new RangeError('bad rule');
    expect(runWithBudget(100, () => 42)).toBe(42);
    expect(() =>
      runWithBudget(100, () => {
        throw failure;
      }),
    ).toThrow(failure);
  });

  it('interrupts a runaway loop even when it catches everything', () => {
    // Arrange
    const spin = () => {
      for (;;) {
        try {
          JSON.parse('{');
        } catch {
          // 模拟 ical.js 内部吞掉异常、继续找下去
        }
      }
    };
    const started = performance.now();

    // Act
    const run = () => runWithBudget(50, spin);

    // Assert
    expect(run).toThrow(TimeBudgetExceeded);
    expect(performance.now() - started).toBeLessThan(1000);
    // 打断之后还能继续用
    expect(runWithBudget(100, () => 'again')).toBe('again');
  });

  it('refuses nested calls, which would share one timer', () => {
    expect(() => runWithBudget(100, () => runWithBudget(100, () => 1))).toThrow(/嵌套/);
    expect(runWithBudget(100, () => 'still usable')).toBe('still usable');
  });
});
