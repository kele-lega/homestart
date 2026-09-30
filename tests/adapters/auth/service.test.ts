import { beforeEach, describe, expect, it } from 'vitest';
import { createAuthService, type AuthService } from '../../../src/adapters/auth/service';
import { AuthInputError, createAuthStore, type AuthStore } from '../../../src/adapters/auth/store';
import { createSessionStore } from '../../../src/adapters/auth/session';

describe('createAuthService', () => {
  let store: AuthStore;
  let service: AuthService;

  beforeEach(() => {
    store = createAuthStore({ filePath: ':memory:' });
    service = createAuthService({ store, sessions: createSessionStore() });
  });

  describe('login', () => {
    it('logs in with correct credentials and returns a session', async () => {
      await service.createUser('alice', 'password123', 'user');
      const result = await service.login('alice', 'password123');
      expect(result.username).toBe('alice');
      expect(result.role).toBe('user');
      expect(service.currentUser(result.sessionId)).toEqual({ userId: expect.any(Number), username: 'alice', role: 'user' });
    });

    it('rejects a wrong password', async () => {
      await service.createUser('bob', 'password123', 'user');
      await expect(service.login('bob', 'wrong-password')).rejects.toThrow(AuthInputError);
    });

    it('rejects an unknown username without revealing that it does not exist', async () => {
      await expect(service.login('nobody', 'whatever1')).rejects.toThrow('用户名或密码不对');
    });
  });

  describe('logout', () => {
    it('invalidates the session', async () => {
      await service.createUser('carol', 'password123', 'admin');
      const { sessionId } = await service.login('carol', 'password123');
      service.logout(sessionId);
      expect(service.currentUser(sessionId)).toBeUndefined();
    });
  });

  describe('createUser', () => {
    it('rejects a duplicate username', async () => {
      await service.createUser('dave', 'password123', 'user');
      await expect(service.createUser('dave', 'password456', 'user')).rejects.toThrow('用户名已经被使用');
    });

    it('rejects a short password', async () => {
      await expect(service.createUser('eve', 'short', 'user')).rejects.toThrow(AuthInputError);
    });
  });

  describe('deleteUser', () => {
    it('deletes another user', async () => {
      await service.createUser('frank', 'password123', 'user');
      const target = store.findByUsername('frank')!;
      service.deleteUser(target.id, 999);
      expect(store.findById(target.id)).toBeUndefined();
    });

    it('refuses to delete the requesting admin themselves', async () => {
      await service.createUser('grace', 'password123', 'admin');
      const self = store.findByUsername('grace')!;
      expect(() => service.deleteUser(self.id, self.id)).toThrow('不能删除自己的账号');
    });
  });

  describe('resetPassword', () => {
    it('replaces the password hash so the old password no longer works', async () => {
      await service.createUser('heidi', 'password123', 'user');
      const target = store.findByUsername('heidi')!;
      await service.resetPassword(target.id, 'newpassword1');
      await expect(service.login('heidi', 'password123')).rejects.toThrow(AuthInputError);
      const result = await service.login('heidi', 'newpassword1');
      expect(result.username).toBe('heidi');
    });
  });

  describe('listUsers', () => {
    it('lists users without password hashes', async () => {
      await service.createUser('ivan', 'password123', 'user');
      const list = service.listUsers();
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('passwordHash');
    });
  });
});
