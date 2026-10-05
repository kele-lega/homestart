import { describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../../src/core/http';
import { createResendMailer } from '../../src/adapters/mail';

const CONFIG = { apiKey: 're_test', from: 'home <noreply@example.org>' };
const MESSAGE = { to: 'ken@example.com', subject: 'hi', text: 'code 123456' };

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('createResendMailer', () => {
  it('posts the message with the API key', async () => {
    const doFetch = reply(200, { id: 'x' });
    await createResendMailer(CONFIG, doFetch as typeof fetch)(MESSAGE);
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_test');
    expect(JSON.parse(String(init.body))).toEqual({ from: CONFIG.from, to: [MESSAGE.to], subject: 'hi', text: 'code 123456' });
  });

  it("puts Resend's reason into the error so the log says why", async () => {
    const doFetch = reply(403, { statusCode: 403, name: 'validation_error', message: 'The example.org domain is not verified.' });
    const error = await createResendMailer(CONFIG, doFetch as typeof fetch)(MESSAGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ status: 403, message: 'api.resend.com 返回 HTTP 403：validation_error - The example.org domain is not verified.' });
  });

  it('still fails cleanly on a non-JSON error or a network error', async () => {
    const html = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(createResendMailer(CONFIG, html as typeof fetch)(MESSAGE)).rejects.toThrow(/^api\.resend\.com 返回 HTTP 502$/);
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(createResendMailer(CONFIG, down as typeof fetch)(MESSAGE)).rejects.toThrow('api.resend.com：fetch failed');
  });
});
