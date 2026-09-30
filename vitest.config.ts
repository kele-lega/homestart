/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// 用 Astro 的 Vite 配置运行 vitest，这样既能测纯 TS 的核心逻辑，也能用 Container API 渲染 .astro 组件
export default getViteConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['_source/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    coverage: {
      // 只统计 .ts：岛屿的交互逻辑都抽在 .ts 里单测；.astro 模板另有 Container API 渲染测试，
      // .svelte 岛屿的 DOM 交互不在单元测试范围内
      include: [
        'src/core/**',
        'src/lib/**',
        'src/adapters/**',
        'src/widgets/**/*.ts',
        'src/pages/**/*.ts',
        'src/middleware.ts',
      ],
      // 只操作 DOM 的浏览器端脚本靠截图与交互验证，不计入单元测试覆盖率
      exclude: ['src/widgets/*/clock.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
