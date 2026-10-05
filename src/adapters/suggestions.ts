/**
 * 建议：一个 JSON 文件，里面是一个数组，新的在前。路径取环境变量 SUGGESTIONS_FILE，默认是工作目录下的 data/suggestions.json。
 * 和公告（./announcements）一样：每次都现读，手改文件立即生效；写入先写临时文件再 rename，进程内串行执行。
 * 文件读不懂时当作没有建议显示，但拒绝写入，不把手改坏的文件整个盖掉
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { logBackgroundError } from '../core/log';
import { parseSuggestions, withDone, withSuggestion, type SuggestionInput } from '../core/suggestions';
import type { Suggestion } from '../lib/suggestions';
import { settingsFilePath, writeAtomic } from './user-store';

export const DEFAULT_SUGGESTIONS_FILE = 'data/suggestions.json';

export function suggestionsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'SUGGESTIONS_FILE', DEFAULT_SUGGESTIONS_FILE);
}

export class SuggestionsStoreError extends Error {
  constructor() {
    super('建议文件格式有误');
    this.name = 'SuggestionsStoreError';
  }
}

type ReadResult = { readonly ok: true; readonly list: readonly Suggestion[] } | { readonly ok: false };

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
    return Array.isArray(data) ? { ok: true, list: parseSuggestions(data) } : { ok: false };
  } catch {
    // JSON.parse 的错误消息会带上一段文件内容，不往外传
    return { ok: false };
  }
}

export interface SuggestionAuthor {
  readonly username: string;
  readonly author: string;
}

export interface SuggestionsService {
  /** 新的在前；没有文件、文件读不懂都是 [] */
  list(): Promise<readonly Suggestion[]>;
  /** input 必须已经校验过 */
  submit(input: SuggestionInput, by: SuggestionAuthor): Promise<void>;
  /** 没有这一条时什么都不做；返回改完后的整个列表 */
  mark(id: string, done: boolean): Promise<readonly Suggestion[]>;
  remove(id: string): Promise<readonly Suggestion[]>;
}

export interface SuggestionsDeps {
  readonly filePath?: () => string;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export function createSuggestionsService({
  filePath = () => suggestionsFilePath(),
  now = Date.now,
  newId = randomUUID,
}: SuggestionsDeps = {}): SuggestionsService {
  let queue: Promise<unknown> = Promise.resolve();
  // 格式有误的文件管理员每次打开首页都会读到，只记一次，读成功后重新计
  let reported = false;

  /** 读-改-写整段排队：两个人同时提交，后一次不会盖掉前一次 */
  function update(change: (list: readonly Suggestion[]) => readonly Suggestion[]): Promise<readonly Suggestion[]> {
    const task = queue.then(async () => {
      const file = filePath();
      const read = await readList(file);
      if (!read.ok) throw new SuggestionsStoreError();
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
      if (!reported) logBackgroundError('suggestions', '建议文件读不懂，按没有建议显示', new SuggestionsStoreError());
      reported = true;
      return [];
    },
    async submit(input, by) {
      await update((list) => withSuggestion(list, { id: newId(), body: input.body, ...by, createdAt: now(), done: false }));
    },
    mark(id, done) {
      return update((list) => withDone(list, id, done));
    },
    remove(id) {
      return update((list) => list.filter((item) => item.id !== id));
    },
  };
}

const defaultService = createSuggestionsService();

export const listSuggestions = () => defaultService.list();
export const submitSuggestion = (input: SuggestionInput, by: SuggestionAuthor) => defaultService.submit(input, by);
export const markSuggestion = (id: string, done: boolean) => defaultService.mark(id, done);
export const removeSuggestion = (id: string) => defaultService.remove(id);
