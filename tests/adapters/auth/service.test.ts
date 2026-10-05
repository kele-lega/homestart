import { beforeEach, describe, expect, it } from 'vitest';
import { openAuthDb } from '../../../src/adapters/auth/db';
import { createAuthDeps, createAuthService, type Actor, type AuthService } from '../../../src/adapters/auth/service';
import { AuthInputError, type AuthStore } from '../../../src/adapters/auth/store';

const PASSWORD = 'password123';

describe('createAuthService', () => {
  let store: AuthStore;
  let service: AuthService;

  beforeEach(() => {
    const deps = createAuthDeps(openAuthDb(':memory:'));
    store = deps.store;
    service = createAuthService(deps);
  });

  async function signIn(username: string, extra: { remember?: boolean; userAgent?: string; ip?: string } = {}) {
    return service.login({ username, password: PASSWORD, remember: false, ...extra });
  }

  const actorOf = (result: Awaited<ReturnType<typeof signIn>>): Actor => result.user;

  describe('login', () => {
    it('logs in with correct credentials and returns a session token', async () => {
      await service.createUser('alice', PASSWORD, 'user');
      const result = await signIn('alice');
      expect(result.user).toMatchObject({ username: 'alice', role: 'user', displayName: null });
      expect(service.currentUser(result.token)).toEqual(result.user);
    });

    it('records the device and the login time', async () => {
      await service.createUser('alice', PASSWORD, 'user');
      const result = await signIn('alice', { remember: true, userAgent: 'UA', ip: '203.0.113.9' });
      expect(result.remember).toBe(true);
      expect(service.listSessions(result.user.userId)).toEqual([
        expect.objectContaining({ userAgent: 'UA', ip: '203.0.113.9', remember: true }),
      ]);
      expect(store.findById(result.user.userId)?.lastLogin).toEqual({ at: expect.any(Number), ip: '203.0.113.9' });
    });

    it('rejects a wrong password', async () => {
      await service.createUser('bob', PASSWORD, 'user');
      await expect(service.login({ username: 'bob', password: 'wrong-password', remember: false })).rejects.toThrow(AuthInputError);
    });

    it('rejects an unknown username without revealing that it does not exist', async () => {
      await expect(service.login({ username: 'nobody', password: 'whatever1', remember: false })).rejects.toThrow('用户名或密码不对');
    });

    it('does not record anything for a failed login', async () => {
      await service.createUser('bob', PASSWORD, 'user');
      await expect(service.login({ username: 'bob', password: 'wrong-password', remember: false })).rejects.toThrow();
      const bob = store.findByUsername('bob')!;
      expect(bob.lastLogin).toBeNull();
      expect(service.listSessions(bob.id)).toEqual([]);
    });
  });

  describe('logout', () => {
    it('invalidates the session', async () => {
      await service.createUser('carol', PASSWORD, 'admin');
      const { token } = await signIn('carol');
      service.logout(token);
      expect(service.currentUser(token)).toBeUndefined();
    });

    it('treats a missing token as signed out', () => {
      expect(service.currentUser(undefined)).toBeUndefined();
    });
  });

  describe('account', () => {
    it('shows the login before this one as the previous login', async () => {
      await service.createUser('dave', PASSWORD, 'user');
      const first = await signIn('dave', { ip: '203.0.113.1' });
      expect(service.account(first.user.userId)?.previousLogin).toBeNull();

      await signIn('dave', { ip: '203.0.113.2' });

      expect(service.account(first.user.userId)).toMatchObject({
        username: 'dave',
        role: 'user',
        previousLogin: { at: expect.any(Number), ip: '203.0.113.1' },
      });
      expect(service.account(first.user.userId)).not.toHaveProperty('passwordHash');
    });

    it('returns undefined for a deleted user', () => {
      expect(service.account(999)).toBeUndefined();
    });
  });

  describe('updateDisplayName', () => {
    it('stores the normalized name and shows it on existing sessions', async () => {
      await service.createUser('erin', PASSWORD, 'user');
      const { token, user } = await signIn('erin');
      expect(service.updateDisplayName(user.userId, '  艾琳 ')).toBe('艾琳');
      expect(service.currentUser(token)?.displayName).toBe('艾琳');
      expect(service.updateDisplayName(user.userId, '')).toBeNull();
    });

    it('rejects invisible characters', async () => {
      await service.createUser('erin', PASSWORD, 'user');
      const { user } = await signIn('erin');
      expect(() => service.updateDisplayName(user.userId, `a${String.fromCodePoint(0x200b)}b`)).toThrow(AuthInputError);
    });
  });

  describe('changePassword', () => {
    it('requires the current password', async () => {
      await service.createUser('frank', PASSWORD, 'user');
      const session = await signIn('frank');
      await expect(service.changePassword(actorOf(session), 'not-it-at-all', 'newpassword1')).rejects.toThrow('当前密码不对');
    });

    it('rejects a short new password and one equal to the current password', async () => {
      await service.createUser('frank', PASSWORD, 'user');
      const actor = actorOf(await signIn('frank'));
      await expect(service.changePassword(actor, PASSWORD, 'short')).rejects.toThrow('密码至少 8 位');
      await expect(service.changePassword(actor, PASSWORD, PASSWORD)).rejects.toThrow('新密码和当前密码一样');
    });

    it('changes the password and signs out every other device', async () => {
      await service.createUser('frank', PASSWORD, 'user');
      const here = await signIn('frank');
      const elsewhere = await signIn('frank', { remember: true });
      const third = await signIn('frank');

      await expect(service.changePassword(actorOf(here), PASSWORD, 'newpassword1')).resolves.toBe(2);

      expect(service.currentUser(here.token)).toBeDefined();
      expect(service.currentUser(elsewhere.token)).toBeUndefined();
      expect(service.currentUser(third.token)).toBeUndefined();
      await expect(signIn('frank')).rejects.toThrow(AuthInputError);
      await expect(service.login({ username: 'frank', password: 'newpassword1', remember: false })).resolves.toBeDefined();
    });
  });

  describe('sessions', () => {
    it('revokes another device but refuses the current one', async () => {
      await service.createUser('gina', PASSWORD, 'user');
      const here = await signIn('gina');
      const there = await signIn('gina');

      expect(() => service.revokeSession(actorOf(here), here.user.sessionId)).toThrow('这是当前设备');
      service.revokeSession(actorOf(here), there.user.sessionId);

      expect(service.currentUser(there.token)).toBeUndefined();
      expect(() => service.revokeSession(actorOf(here), there.user.sessionId)).toThrow('这个登录已经失效了');
    });

    it("cannot revoke someone else's session", async () => {
      await service.createUser('gina', PASSWORD, 'user');
      await service.createUser('hank', PASSWORD, 'user');
      const gina = await signIn('gina');
      const hank = await signIn('hank');
      expect(() => service.revokeSession(actorOf(gina), hank.user.sessionId)).toThrow(AuthInputError);
      expect(service.currentUser(hank.token)).toBeDefined();
    });

    it('signs out all other devices', async () => {
      await service.createUser('gina', PASSWORD, 'user');
      const here = await signIn('gina');
      await signIn('gina');
      await signIn('gina');
      expect(service.revokeOtherSessions(actorOf(here))).toBe(2);
      expect(service.listSessions(here.user.userId).map((row) => row.id)).toEqual([here.user.sessionId]);
    });
  });

  describe('createUser', () => {
    it('rejects a duplicate username', async () => {
      await service.createUser('dave', PASSWORD, 'user');
      await expect(service.createUser('dave', 'password456', 'user')).rejects.toThrow('用户名已经被使用');
    });

    it('rejects a short password', async () => {
      await expect(service.createUser('eve', 'short', 'user')).rejects.toThrow(AuthInputError);
    });
  });

  describe('deleteUser', () => {
    it('deletes another user and signs them out', async () => {
      await service.createUser('frank', PASSWORD, 'user');
      const { token, user } = await signIn('frank');
      service.deleteUser(user.userId, 999);
      expect(store.findById(user.userId)).toBeUndefined();
      expect(service.currentUser(token)).toBeUndefined();
    });

    it('returns the uploaded avatar file so the caller can delete it', async () => {
      await service.createUser('heidi', PASSWORD, 'user');
      const user = store.findByUsername('heidi')!;
      expect(service.deleteUser(user.id, 999)).toBeNull();
      await service.createUser('ivan', PASSWORD, 'user');
      const ivan = store.findByUsername('ivan')!;
      service.setAvatar(ivan.id, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png');
      expect(service.deleteUser(ivan.id, 999)).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png');
    });

    it('refuses to delete the requesting admin themselves', async () => {
      await service.createUser('grace', PASSWORD, 'admin');
      const self = store.findByUsername('grace')!;
      expect(() => service.deleteUser(self.id, self.id)).toThrow('不能删除自己的账号');
    });
  });

  describe('setAvatar', () => {
    it('swaps the avatar file and returns the one it replaced', async () => {
      await service.createUser('judy', PASSWORD, 'user');
      const user = store.findByUsername('judy')!;
      expect(service.setAvatar(user.id, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')).toBeNull();
      expect(service.setAvatar(user.id, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp')).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png');
      expect(service.account(user.id)?.avatar).toMatchObject({ image: '/avatars/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp' });
      expect(service.setAvatar(user.id, null)).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp');
      expect(service.account(user.id)?.avatar).toMatchObject({ seed: user.avatarSeed, image: null });
    });

    it('rejects an unknown account', () => {
      expect(() => service.setAvatar(999, null)).toThrow(AuthInputError);
    });
  });

  describe('resetPassword', () => {
    it('replaces the password and signs the user out everywhere', async () => {
      await service.createUser('admin', PASSWORD, 'admin');
      await service.createUser('heidi', PASSWORD, 'user');
      const admin = actorOf(await signIn('admin'));
      const heidi = await signIn('heidi', { remember: true });

      await service.resetPassword(heidi.user.userId, 'newpassword1', admin);

      expect(service.currentUser(heidi.token)).toBeUndefined();
      await expect(signIn('heidi')).rejects.toThrow(AuthInputError);
      await expect(service.login({ username: 'heidi', password: 'newpassword1', remember: false })).resolves.toBeDefined();
    });

    it('keeps the current device when admins reset their own password', async () => {
      await service.createUser('admin', PASSWORD, 'admin');
      const here = await signIn('admin');
      const there = await signIn('admin');

      await service.resetPassword(here.user.userId, 'newpassword1', actorOf(here));

      expect(service.currentUser(here.token)).toBeDefined();
      expect(service.currentUser(there.token)).toBeUndefined();
    });

    it('rejects an unknown account', async () => {
      await expect(service.resetPassword(999, 'newpassword1', { userId: 1, sessionId: 1 })).rejects.toThrow('没有这个账号');
    });
  });

  describe('listUsers', () => {
    it('lists users without password hashes', async () => {
      await service.createUser('ivan', PASSWORD, 'user');
      const list = service.listUsers();
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('passwordHash');
    });
  });
});
