import { vitePreprocess } from '@astrojs/svelte';

// Svelte 组件里的 <script lang="ts"> 与 <style> 由 Vite 预处理
export default {
  preprocess: vitePreprocess(),
};
