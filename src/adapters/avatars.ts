/**
 * 自己上传的头像：浏览器先裁成正方形、缩到 256×256 再传上来（lib/avatar-image），这里只认文件头、限大小，
 * 按「账号 + 内容」的哈希命名存进一个目录，经 /avatars/<文件名> 提供（pages/avatars/[file].ts）。
 * 文件名猜不出来，和网站图标一样公开提供、长期缓存。哈希里带上账号：两个人传同一张图也是两个文件，
 * 换头像、删账号时直接删掉旧文件，不用查还有没有别人在用。目录取环境变量 AVATARS_DIR，默认 data/avatars。
 *
 * 只收 PNG、JPG、GIF、WebP：头像要在各处当 <img> 显示，SVG、ICO 没有必要收
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { sniffIcon } from './site-icons/store';
import { settingsFilePath } from './user-store';

export const DEFAULT_AVATARS_DIR = 'data/avatars';
/** 256×256 的 WebP 一般几十 KB；留足余量给不支持 WebP、只能出 PNG 的浏览器 */
export const MAX_AVATAR_BYTES = 512 * 1024;

export function avatarsDir(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'AVATARS_DIR', DEFAULT_AVATARS_DIR);
}

export type AvatarType = 'png' | 'jpg' | 'gif' | 'webp';

export const AVATAR_MIME: Readonly<Record<AvatarType, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** 文件名：32 位十六进制哈希 + 扩展名；数据库里存的就是它 */
export const AVATAR_FILE = /^([0-9a-f]{32})\.(png|jpg|gif|webp)$/;

export const avatarUrl = (file: string) => `/avatars/${file}`;

export class AvatarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarInputError';
  }
}

export interface AvatarFiles {
  /** 存一张头像，返回文件名；不是支持的图片或太大时抛 AvatarInputError。owner 是账号 id */
  save(owner: number, bytes: Uint8Array): Promise<string>;
  /** 按文件名读；文件名不合格或不存在时 undefined */
  read(file: string): Promise<{ readonly bytes: Buffer; readonly type: AvatarType } | undefined>;
  /** 删掉一个文件；不存在、文件名不合格都当已经删了 */
  remove(file: string): Promise<void>;
}

export function createAvatarFiles(dir: () => string = () => avatarsDir()): AvatarFiles {
  return {
    async save(owner, bytes) {
      if (bytes.byteLength === 0) throw new AvatarInputError('图片是空的');
      if (bytes.byteLength > MAX_AVATAR_BYTES) throw new AvatarInputError(`图片太大（最多 ${MAX_AVATAR_BYTES / 1024} KB）`);
      const type = sniffIcon(bytes);
      if (type !== 'png' && type !== 'jpg' && type !== 'gif' && type !== 'webp') {
        throw new AvatarInputError('只支持 PNG、JPG、GIF、WebP 图片');
      }
      const name = `${createHash('sha256').update(`${owner}\n`).update(bytes).digest('hex').slice(0, 32)}.${type}`;
      const directory = dir();
      const target = path.join(directory, name);
      // 同一个人传同一张图就是同一个文件，已经有了不用再写
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
      return name;
    },
    async read(file) {
      const match = AVATAR_FILE.exec(file);
      if (!match) return undefined;
      try {
        return { bytes: await readFile(path.join(dir(), file)), type: match[2] as AvatarType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async remove(file) {
      if (!AVATAR_FILE.test(file)) return;
      await rm(path.join(dir(), file), { force: true });
    },
  };
}

const defaultFiles = createAvatarFiles();

export const getAvatarFiles = () => defaultFiles;
