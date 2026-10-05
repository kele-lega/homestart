/**
 * 按登录用户保存的一项服务端设置：一个 JSON 文件 { 用户名: 值 }。日历订阅地址、Steam 账号是字符串，个人偏好是一个对象，各用一个文件。
 * 每次都现读，手改文件立即生效；写入先写同目录的临时文件再 rename，进程内串行执行。
 * 设置可能等同于访问凭据（比如订阅地址）：文件只在服务端，写入时文件权限 0600、新建的目录 0700（Windows 上无效）。
 * 读不懂的条目读作未配置，写入时原样保留，不会被删掉。
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { USER_NAME } from '../core/api';
import { logBackgroundError } from '../core/log';

export interface UserStore<T = string> {
  /** 用户的设置（经过 parse 规范化）；没配置、条目无效、文件格式有误都返回 undefined */
  get(user: string): Promise<T | undefined>;
  /** value 为 undefined 时删除该用户的条目；其他条目原样保留。文件格式有误时拒绝写入 */
  put(user: string, value: T | undefined): Promise<void>;
}

/** 字符串类条目的 parse：不是字符串的读作无效 */
export function stringEntry(parse: (value: string) => string | undefined): (value: unknown) => string | undefined {
  return (value) => (typeof value === 'string' ? parse(value) : undefined);
}

export interface UserStoreOptions<T> {
  /** 每次读写都重新取，环境变量改了立即生效 */
  readonly filePath: () => string;
  /** 条目（JSON 解析后的值）的校验和规范化；返回 undefined 表示条目无效 */
  readonly parse: (value: unknown) => T | undefined;
  /** 文件不是 JSON 对象时的错误；消息里不能带文件内容 */
  readonly formatError: () => Error;
  /** 文件格式有误时记一条日志：标签和说明 */
  readonly log: { readonly label: string; readonly message: string };
}

/** 设置文件的绝对路径：环境变量 name 的值，没设置时用 fallback；相对路径按当前工作目录解析 */
export function settingsFilePath(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return path.resolve(env[name]?.trim() || fallback);
}

type RawUsers = Readonly<Record<string, unknown>>;
type ReadResult = { readonly ok: true; readonly users: RawUsers } | { readonly ok: false };

const BOM = 0xfeff;

async function readUsers(file: string): Promise<ReadResult> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, users: {} };
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === BOM ? text.slice(1) : text);
  } catch {
    // JSON.parse 的错误消息会带上一段文件内容，不往外传
    return { ok: false };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false };
  return { ok: true, users: data as RawUsers };
}

/** 先写同目录的临时文件（0600）再 rename，读的人要么看到旧文件、要么看到新文件，不会读到写了一半的 */
export async function writeAtomic(target: string, text: string): Promise<void> {
  const directory = path.dirname(target);
  // 只影响新建的目录；已存在的目录（比如 Docker 挂载的卷）权限不变
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export function createUserStore<T>(options: UserStoreOptions<T>): UserStore<T> {
  const { filePath, parse, formatError, log } = options;
  let queue: Promise<unknown> = Promise.resolve();
  // 格式有误的文件每个请求都会读到，只记一次，读成功后重新计
  let reported = false;

  async function write(user: string, value: T | undefined): Promise<void> {
    if (!USER_NAME.test(user)) throw new Error('无效的用户名');
    const file = filePath();
    const read = await readUsers(file);
    if (!read.ok) throw formatError();
    const others = Object.entries(read.users).filter(([key]) => key !== user);
    const next = Object.fromEntries(value === undefined ? others : [...others, [user, value]]);
    await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  }

  return {
    async get(user) {
      if (!USER_NAME.test(user)) return undefined;
      const read = await readUsers(filePath());
      if (!read.ok) {
        if (!reported) logBackgroundError(log.label, log.message, formatError());
        reported = true;
        return undefined;
      }
      reported = false;
      return Object.hasOwn(read.users, user) ? parse(read.users[user]) : undefined;
    },
    put(user, value) {
      // 每次写入都排在上一次之后，并且重新读文件，并发保存不会互相覆盖
      const task = queue.then(() => write(user, value));
      // 失败由 task 交给调用方处理；队列本身继续往下走
      queue = task.catch(() => undefined);
      return task;
    },
  };
}
