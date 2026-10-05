import { z } from 'astro/zod';

/** 各配置文件共用的 schema 片段 */

export const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 只能包含小写字母、数字和连字符，且以字母开头');

// 每个色调在 src/styles/tones.css 里都有对应的颜色，两边由 tests/styles/tones.test.ts 保持一致
export const ToneSchema = z.enum(['neutral', 'pink', 'blue', 'purple', 'green', 'peach', 'slate']);
export type Tone = z.infer<typeof ToneSchema>;

/**
 * 站内静态资源路径（public/ 下）。这些值会进入 HTML/CSS，所以只允许安全字符；
 * 禁止 // 开头（协议相对地址会指向外站）和 ..。
 */
export const SITE_PATH = /^\/(?!\/)(?!.*\.\.)[\w\-./]+$/;
