// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';

export default defineConfig({
  // 配置文件在运行时读取（Docker 挂载 config/ 后刷新即生效），因此使用按需渲染
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Svelte 只用于真正需要交互的 island（搜索、日历等），其余保持服务端渲染
  integrations: [svelte()],
  server: { port: 4321 },
});
