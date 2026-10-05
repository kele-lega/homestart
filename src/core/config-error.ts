/** 配置文件校验失败。一次性收集所有问题，方便对照修改 */
export class ConfigError extends Error {
  readonly file: string;
  readonly problems: readonly string[];

  constructor(file: string, problems: readonly string[]) {
    super(`${file} 配置有误：\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.file = file;
    this.problems = problems;
  }
}

interface IssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** 把 zod issue 转成 "zones.1.items: xxx" 形式 */
export function formatIssues(issues: readonly IssueLike[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
