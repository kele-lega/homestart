/**
 * 公告：一个 JSON 文件，里面是一个数组，新的在前。路径取环境变量 ANNOUNCEMENTS_FILE，默认是工作目录下的 data/announcements.json。
 * 每次都现读，手改文件立即生效；写入先写临时文件再 rename（见 ./user-store），进程内串行执行。
 * 文件读不懂时当作没有公告显示，但拒绝写入，不把手改坏的文件整个盖掉
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseAnnouncements, withAnnouncement, type AnnouncementInput } from '../core/announcements';
import { logBackgroundError } from '../core/log';
import type { Announcement } from '../lib/announcements';
import { settingsFilePath, writeAtomic } from './user-store';

export const DEFAULT_ANNOUNCEMENTS_FILE = 'data/announcements.json';

export function announcementsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'ANNOUNCEMENTS_FILE', DEFAULT_ANNOUNCEMENTS_FILE);
}

export class AnnouncementsStoreError extends Error {
  constructor() {
    super('公告文件格式有误');
    this.name = 'AnnouncementsStoreError';
  }
}

type ReadResult = { readonly ok: true; readonly list: readonly Announcement[] } | { readonly ok: false };

const BOM = 0xfeff;

async function readList(file: string): Promise<ReadResult> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, list: [] };
    throw error;
  }
  try {
    const data: unknown = JSON.parse(text.charCodeAt(0) === BOM ? text.slice(1) : text);
    return Array.isArray(data) ? { ok: true, list: parseAnnouncements(data) } : { ok: false };
  } catch {
    // JSON.parse 的错误消息会带上一段文件内容，不往外传
    return { ok: false };
  }
}

export interface AnnouncementsService {
  /** 新的在前；没有文件、文件读不懂都是 [] */
  list(): Promise<readonly Announcement[]>;
  /** input 必须已经校验过；返回发布后的整个列表 */
  publish(input: AnnouncementInput, author: string): Promise<readonly Announcement[]>;
  /** 没有这一条时什么都不做；返回删除后的整个列表 */
  remove(id: string): Promise<readonly Announcement[]>;
}

export interface AnnouncementsDeps {
  readonly filePath?: () => string;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export function createAnnouncementsService({
  filePath = () => announcementsFilePath(),
  now = Date.now,
  newId = randomUUID,
}: AnnouncementsDeps = {}): AnnouncementsService {
  let queue: Promise<unknown> = Promise.resolve();
  // 格式有误的文件每次打开首页都会读到，只记一次，读成功后重新计
  let reported = false;

  /** 读-改-写整段排队：两个管理员同时发布，后一次不会盖掉前一次 */
  function update(change: (list: readonly Announcement[]) => readonly Announcement[]): Promise<readonly Announcement[]> {
    const task = queue.then(async () => {
      const file = filePath();
      const read = await readList(file);
      if (!read.ok) throw new AnnouncementsStoreError();
      const next = change(read.list);
      await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
    queue = task.catch(() => undefined);
    return task;
  }

  return {
    async list() {
      const read = await readList(filePath());
      if (read.ok) {
        reported = false;
        return read.list;
      }
      if (!reported) logBackgroundError('announcements', '公告文件读不懂，首页按没有公告显示', new AnnouncementsStoreError());
      reported = true;
      return [];
    },
    publish(input, author) {
      return update((list) => withAnnouncement(list, { id: newId(), ...input, createdAt: now(), author }));
    },
    remove(id) {
      return update((list) => list.filter((item) => item.id !== id));
    },
  };
}

const defaultService = createAnnouncementsService();

export const listAnnouncements = () => defaultService.list();
export const publishAnnouncement = (input: AnnouncementInput, author: string) => defaultService.publish(input, author);
export const removeAnnouncement = (id: string) => defaultService.remove(id);
