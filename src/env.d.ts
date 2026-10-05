/// <reference types="astro/client" />
import type { SessionUser } from './adapters/auth/session';

declare global {
  namespace App {
    interface Locals {
      /** 中间件解析登录 Cookie 后写入；没有登录会话时为 undefined */
      auth?: SessionUser;
    }
  }
}
