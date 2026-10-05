/**
 * 同步代码的硬性时间上限。ical.js 遇到某些自相矛盾的重复规则（例如 FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30）
 * 会在一次调用里一直找下去，迭代次数上限拦不住，整个进程跟着卡死。
 * vm 的 timeout 由 V8 从另一个线程打断正在执行的 JS，对传进去的普通函数同样有效，
 * 函数里的 try/catch 也接不住；打断后上下文仍可继续使用。每次调用约 0.1 毫秒的额外开销。
 */
import vm from 'node:vm';

export class TimeBudgetExceeded extends Error {
  constructor() {
    super('超出时间预算');
    this.name = 'TimeBudgetExceeded';
  }
}

const context = vm.createContext({});
const script = new vm.Script('task()');
let running = false;

/** 在 budgetMs 毫秒内同步执行 task；超时抛 TimeBudgetExceeded，其他异常原样抛出。不能嵌套调用。 */
export function runWithBudget<T>(budgetMs: number, task: () => T): T {
  if (running) throw new Error('runWithBudget 不能嵌套调用');
  running = true;
  context.task = task;
  try {
    return script.runInContext(context, { timeout: Math.max(1, Math.floor(budgetMs)) }) as T;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new TimeBudgetExceeded();
    throw error;
  } finally {
    context.task = undefined;
    running = false;
  }
}
