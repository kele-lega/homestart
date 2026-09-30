/**
 * 密码哈希：scrypt（Node 内置，不引入额外依赖）。每个密码单独加盐，参数写进存储串里，
 * 以后要调高强度也能识别旧串。格式：scrypt$<N>$<r>$<p>$<盐 hex>$<哈希 hex>
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const FORMAT = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/;

function deriveKey(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await deriveKey(password, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** 存储串格式有误时按不匹配处理，不抛错 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = FORMAT.exec(stored);
  if (!match) return false;
  const [, n, r, p, saltHex, hashHex] = match;
  const salt = Buffer.from(saltHex!, 'hex');
  const expected = Buffer.from(hashHex!, 'hex');
  const derived = await deriveKey(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
