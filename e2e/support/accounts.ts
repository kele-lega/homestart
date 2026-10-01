/** e2e 服务端启动时建的管理员（内存库，每次启动都是新的），playwright.config.ts 和登录用例共用 */
export const E2E_ADMIN = { username: 'e2e-admin', password: 'e2e-password-1' } as const;
