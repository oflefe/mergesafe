import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string | undefined,
): void {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('GITHUB_WEBHOOK_SECRET is required in production');
    }
    return;
  }

  if (!signature) {
    throw new UnauthorizedException('Missing webhook signature');
  }

  const digest = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expected = Buffer.from(digest);
  const provided = Buffer.from(signature);

  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new UnauthorizedException('Invalid webhook signature');
  }
}
