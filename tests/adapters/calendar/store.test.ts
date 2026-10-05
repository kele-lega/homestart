import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarStoreError, createCalendarStore, DEFAULT_USERS_FILE, usersFilePath } from '../../../src/adapters/calendar/store';

// 其余文件操作都是真的；只有换名这一步可以让个别用例失败
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'calendar-store-'));
  file = path.join(dir, 'nested', 'users.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const store = () => createCalendarStore({ filePath: () => file });
const readText = () => readFile(file, 'utf8');
const BOM = String.fromCharCode(0xfeff);

async function seed(content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

describe('usersFilePath', () => {
  it.each([
    [{}, path.resolve(DEFAULT_USERS_FILE)],
    [{ CALENDAR_USERS_FILE: '  ' }, path.resolve(DEFAULT_USERS_FILE)],
    [{ CALENDAR_USERS_FILE: 'secrets/users.json' }, path.resolve('secrets/users.json')],
  ])('%o → %s', (env, expected) => {
    // Act + Assert
    expect(usersFilePath(env)).toBe(expected);
  });

  it('默认的存储每次调用都按当时的环境变量取路径', async () => {
    // Arrange
    vi.stubEnv('CALENDAR_USERS_FILE', file);
    const defaultStore = createCalendarStore();

    // Act
    await defaultStore.put('alice', 'https://example.com/a.ics');
    vi.stubEnv('CALENDAR_USERS_FILE', path.join(dir, 'other.json'));

    // Assert
    expect(JSON.parse(await readText())).toEqual({ alice: 'https://example.com/a.ics' });
    expect(await defaultStore.get('alice')).toBeUndefined();
  });
});

describe('createCalendarStore：读写', () => {
  it('文件不存在时读作未配置；第一次保存建目录、写成带缩进的 JSON', async () => {
    // Arrange
    const users = store();

    // Act
    const before = await users.get('alice');
    await users.put('alice', 'https://example.com/a.ics');

    // Assert
    expect(before).toBeUndefined();
    expect(await readText()).toBe('{\n  "alice": "https://example.com/a.ics"\n}\n');
    expect(await users.get('alice')).toBe('https://example.com/a.ics');
  });

  it('兼容旧 users.json；读出规范化后的地址', async () => {
    // Arrange
    await seed(`${BOM}${JSON.stringify({ admin: '  https://Calendar.Google.com/calendar/ical/x/private-y/basic.ics ', bob: 'https://b.example/c.ics' })}`);

    // Act
    const admin = await store().get('admin');

    // Assert
    expect(admin).toBe('https://calendar.google.com/calendar/ical/x/private-y/basic.ics');
    expect(await store().get('bob')).toBe('https://b.example/c.ics');
  });

  it('读不懂的条目读作未配置，写别的用户时原样保留', async () => {
    // Arrange
    const raw = { 'bad user': 'https://x.example/a.ics', carol: 42, dave: 'webcal://d.example/a.ics', erin: 'https://e.example/a.ics' };
    await seed(JSON.stringify(raw));
    const users = store();

    // Act
    const results = await Promise.all(['bad user', 'carol', 'dave', 'toString', '__proto__'].map((user) => users.get(user)));
    await users.put('frank', 'https://f.example/a.ics');

    // Assert
    expect(results).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(JSON.parse(await readText())).toEqual({ ...raw, frank: 'https://f.example/a.ics' });
  });

  it('put(undefined) 只删自己的条目；用户名 __proto__ 也只是普通键', async () => {
    // Arrange
    await seed(JSON.stringify({ alice: 'https://a.example/a.ics', bob: 'https://b.example/b.ics' }));
    const users = store();

    // Act
    await users.put('alice', undefined);
    await users.put('__proto__', 'https://p.example/p.ics');

    // Assert
    expect(await readText()).toBe('{\n  "bob": "https://b.example/b.ics",\n  "__proto__": "https://p.example/p.ics"\n}\n');
    expect(await users.get('__proto__')).toBe('https://p.example/p.ics');
  });

  it('并发保存排队执行，互不覆盖，后保存的生效；写完不留临时文件', async () => {
    // Arrange
    const users = store();

    // Act
    await Promise.all([
      users.put('alice', 'https://a.example/1.ics'),
      users.put('bob', 'https://b.example/b.ics'),
      users.put('alice', 'https://a.example/2.ics'),
    ]);

    // Assert
    expect(JSON.parse(await readText())).toEqual({ alice: 'https://a.example/2.ics', bob: 'https://b.example/b.ics' });
    expect(await readdir(path.dirname(file))).toEqual(['users.json']);
  });

  it('一次写入失败不影响排在后面的写入', async () => {
    // Arrange
    const users = store();

    // Act
    const failing = users.put('bad user', 'https://x.example/x.ics');
    const next = users.put('alice', 'https://a.example/a.ics');

    // Assert
    await expect(failing).rejects.toThrow('无效的用户名');
    await expect(next).resolves.toBeUndefined();
    expect(JSON.parse(await readText())).toEqual({ alice: 'https://a.example/a.ics' });
  });

  it('换名失败时原文件保持不变，临时文件被删掉，错误照常抛出', async () => {
    // Arrange：比如 Windows 上文件正被别的程序占用
    const original = `${JSON.stringify({ bob: 'https://b.example/b.ics' }, null, 2)}\n`;
    await seed(original);
    const busy = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    vi.mocked(rename).mockRejectedValueOnce(busy);

    // Act
    const result = store().put('alice', 'https://a.example/a.ics');

    // Assert
    await expect(result).rejects.toBe(busy);
    expect(await readText()).toBe(original);
    expect(await readdir(path.dirname(file))).toEqual(['users.json']);
  });
});

describe('createCalendarStore：文件有问题', () => {
  it.each(['{"alice": "https://secret.example/token', '[]', 'null'])('格式有误（%s）：读作未配置、只记一次日志且不含内容；拒绝写入，文件不动', async (content) => {
    // Arrange
    await seed(content);
    const users = store();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const reads = [await users.get('alice'), await users.get('alice')];
    const write = users.put('bob', 'https://b.example/b.ics');

    // Assert
    expect(reads).toEqual([undefined, undefined]);
    await expect(write).rejects.toBeInstanceOf(CalendarStoreError);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toContain('日历设置文件格式有误');
    expect(String(log.mock.calls[0][0])).not.toContain('secret');
    expect(await readText()).toBe(content);
  });

  it('不是“文件不存在”的读取错误照常抛出', async () => {
    // Arrange：路径指向一个目录
    const users = createCalendarStore({ filePath: () => dir });

    // Act + Assert
    await expect(users.get('alice')).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(users.put('alice', 'https://a.example/a.ics')).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
