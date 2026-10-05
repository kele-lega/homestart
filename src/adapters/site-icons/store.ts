/**
 * 网站图标存在本站：设置页「导航」里自动抓取或手动上传的图标，按内容的哈希命名存进一个目录，
 * 经 /site-icons/<文件名> 提供（pages/site-icons/[file].ts）。同样的图片只存一份，各账号共用；
 * 文件名由内容决定、猜不出来，没有按账号隔离的必要。目录取环境变量 SITE_ICONS_DIR，默认 data/site-icons。
 *
 * 只收认得出的图片格式（看文件头，不信扩展名和 Content-Type）。SVG 也收，提供时带上禁止脚本的 CSP
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { settingsFilePath } from '../user-store';

export const DEFAULT_SITE_ICONS_DIR = 'data/site-icons';
export const MAX_ICON_BYTES = 256 * 1024;

export function siteIconsDir(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'SITE_ICONS_DIR', DEFAULT_SITE_ICONS_DIR);
}

export type IconType = 'png' | 'jpg' | 'gif' | 'webp' | 'ico' | 'svg';

export const ICON_MIME: Readonly<Record<IconType, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** 文件名：32 位十六进制哈希 + 扩展名 */
export const ICON_FILE = /^([0-9a-f]{32})\.(png|jpg|gif|webp|ico|svg)$/;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

// SVG 是文本：去掉 BOM、XML 声明、注释和 DOCTYPE 后，第一个标签必须是 <svg
const SVG_START = /^(?:\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*<svg[\s>]/i;

/** 看文件头认格式；认不出返回 undefined */
export function sniffIcon(bytes: Uint8Array): IconType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  // ICO：保留字 0、类型 1、至少一张图
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) && (bytes[4] ?? 0) + (bytes[5] ?? 0) > 0) return 'ico';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '');
  if (SVG_START.test(head)) return 'svg';
  return undefined;
}

export class IconInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IconInputError';
  }
}

export interface IconStore {
  /** 存一张图标，返回站内路径 /site-icons/<文件名>；不是图片或太大时抛 IconInputError */
  save(bytes: Uint8Array): Promise<string>;
  /** 按文件名读；文件名不合格或不存在时 undefined */
  read(file: string): Promise<{ readonly bytes: Buffer; readonly type: IconType } | undefined>;
}

export function createIconStore(dir: () => string = () => siteIconsDir()): IconStore {
  return {
    async save(bytes) {
      if (bytes.byteLength === 0) throw new IconInputError('图片是空的');
      if (bytes.byteLength > MAX_ICON_BYTES) throw new IconInputError(`图片太大（最多 ${MAX_ICON_BYTES / 1024} KB）`);
      const type = sniffIcon(bytes);
      if (!type) throw new IconInputError('只支持 PNG、JPG、GIF、WebP、ICO、SVG 图片');
      const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${type}`;
      const directory = dir();
      const target = path.join(directory, name);
      // 内容相同就是同一个文件，已经有了不用再写
      const exists = await stat(target).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temp = path.join(directory, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
        try {
          const handle = await open(temp, 'wx', 0o600);
          try {
            await handle.writeFile(bytes);
          } finally {
            await handle.close();
          }
          await rename(temp, target);
        } catch (error) {
          await rm(temp, { force: true });
          throw error;
        }
      }
      return `/site-icons/${name}`;
    },
    async read(file) {
      const match = ICON_FILE.exec(file);
      if (!match) return undefined;
      try {
        return { bytes: await readFile(path.join(dir(), file)), type: match[2] as IconType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
  };
}

const defaultStore = createIconStore();

export const saveIcon = (bytes: Uint8Array) => defaultStore.save(bytes);
export const readIcon = (file: string) => defaultStore.read(file);
