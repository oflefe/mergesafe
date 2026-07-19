import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { verifyWebhookSignature } from '../../../src/webhooks/webhook-signature';

function signBody(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

describe('verifyWebhookSignature', () => {
  const rawBody = Buffer.from('{"action":"opened"}');
  const secret = 'test-secret';

  it('accepts a valid signature', () => {
    const signature = signBody(rawBody, secret);
    expect(() => verifyWebhookSignature(rawBody, signature, secret)).not.toThrow();
  });

  it('rejects an invalid signature', () => {
    expect(() => verifyWebhookSignature(rawBody, 'sha256=invalidsignature', secret)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing signature when a secret is configured', () => {
    expect(() => verifyWebhookSignature(rawBody, undefined, secret)).toThrow(UnauthorizedException);
  });

  it('allows a missing secret and signature outside of production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      expect(() => verifyWebhookSignature(rawBody, undefined, undefined)).not.toThrow();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('rejects a missing secret in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => verifyWebhookSignature(rawBody, undefined, undefined)).toThrow(UnauthorizedException);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
