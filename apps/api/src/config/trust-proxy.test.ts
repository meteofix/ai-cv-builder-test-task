import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';
import { trustProxyAddresses } from './trust-proxy.js';

describe('TRUST_PROXY default', () => {
  // The same trust list the API hands to Fastify, checked against a real Fastify instance.
  const defaultList = trustProxyAddresses(envSchema.shape.TRUST_PROXY.parse(undefined));

  async function ipSeenFor(remoteAddress: string) {
    const fastify = Fastify({ trustProxy: defaultList });
    fastify.get('/ip', (request) => ({ ip: request.ip }));
    const res = await fastify.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    return res.json<{ ip: string }>().ip;
  }

  it('takes the client address from X-Forwarded-For when the proxy has a private address (nginx in compose)', async () => {
    expect(await ipSeenFor('172.18.0.5')).toBe('203.0.113.9');
  });

  it('ignores X-Forwarded-For from a public client, so the header cannot dodge the login throttler', async () => {
    expect(await ipSeenFor('198.51.100.7')).toBe('198.51.100.7');
  });
});
