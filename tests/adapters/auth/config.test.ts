import { describe, expect, it } from 'vitest';
import { readAuthConfig } from '../../../src/adapters/auth/config';

const FULL = {
  SITE_ORIGIN: 'https://home.example.org/',
  GITHUB_CLIENT_ID: 'gh-id',
  GITHUB_CLIENT_SECRET: 'gh-secret',
  GOOGLE_CLIENT_ID: 'gg-id',
  GOOGLE_CLIENT_SECRET: 'gg-secret',
  RESEND_API_KEY: 're_key',
  MAIL_FROM: 'homestart <noreply@example.org>',
  TURNSTILE_SITE_KEY: 'site-key',
  TURNSTILE_SECRET_KEY: 'secret-key',
  SIGNUP_DAILY_LIMIT: '7',
  MAIL_DAILY_LIMIT: '30',
};

describe('readAuthConfig', () => {
  it('turns everything off with an empty environment', () => {
    expect(readAuthConfig({})).toEqual({
      siteOrigin: null,
      oauth: {},
      mail: null,
      turnstile: null,
      dailySignupLimit: 50,
      dailyMailLimit: 90,
    });
  });

  it('reads a full environment', () => {
    expect(readAuthConfig(FULL)).toEqual({
      siteOrigin: 'https://home.example.org',
      oauth: {
        github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
        google: { clientId: 'gg-id', clientSecret: 'gg-secret' },
      },
      mail: { apiKey: 're_key', from: 'homestart <noreply@example.org>' },
      turnstile: { siteKey: 'site-key', secretKey: 'secret-key' },
      dailySignupLimit: 7,
      dailyMailLimit: 30,
    });
  });

  it('only accepts an https origin (or localhost) and drops the path', () => {
    expect(readAuthConfig({ SITE_ORIGIN: 'http://home.example.org' }).siteOrigin).toBeNull();
    expect(readAuthConfig({ SITE_ORIGIN: 'not a url' }).siteOrigin).toBeNull();
    expect(readAuthConfig({ SITE_ORIGIN: 'http://localhost:4321/x' }).siteOrigin).toBe('http://localhost:4321');
    expect(readAuthConfig({ SITE_ORIGIN: ' https://home.example.org/path?q ' }).siteOrigin).toBe('https://home.example.org');
  });

  it('turns OAuth off without a site origin, since there is no callback address', () => {
    expect(readAuthConfig({ ...FULL, SITE_ORIGIN: undefined }).oauth).toEqual({});
  });

  it('needs both halves of every pair', () => {
    const config = readAuthConfig({
      ...FULL,
      GOOGLE_CLIENT_SECRET: '  ',
      MAIL_FROM: '',
      TURNSTILE_SECRET_KEY: undefined,
    });
    expect(Object.keys(config.oauth)).toEqual(['github']);
    expect(config.mail).toBeNull();
    expect(config.turnstile).toBeNull();
  });

  it('falls back to the default limits for junk values', () => {
    for (const value of ['0', '-3', '2.5', 'many', '']) {
      const config = readAuthConfig({ SIGNUP_DAILY_LIMIT: value, MAIL_DAILY_LIMIT: value });
      expect([config.dailySignupLimit, config.dailyMailLimit]).toEqual([50, 90]);
    }
  });
});
