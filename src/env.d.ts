/// <reference types="astro/client" />
import type { Role } from './adapters/auth/store';

declare global {
  namespace App {
    interface Locals {
      /** 中间件解析登录 Cookie 后写入；没有登录会话时为 undefined */
      auth?: { readonly userId: number; readonly username: string; readonly role: Role };
    }
  }
}
