import { VerificationService } from './verification.service';
import { PolicyConfigError, PolicyLoader } from './policy-loader';
import { safeDocsPr } from '../../test/fixtures/pull-request.fixtures';

describe('VerificationService', () => {
  it('fails safely when the policy config is invalid', () => {
    const policyLoader = {
      load: () => {
        throw new PolicyConfigError('Invalid policy config: version must be 1.');
      },
    } as unknown as PolicyLoader;
    const service = new VerificationService(policyLoader);

    const result = service.verify({
      ...safeDocsPr,
      policyText: 'version: 2\nrules: []\n',
    });

    expect(result.verdict).toBe('fail');
    expect(result.checkConclusion).toBe('failure');
    expect(result.policyFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'policy-config-invalid',
          verdict: 'fail',
          message: 'Invalid policy config: version must be 1.',
        }),
      ]),
    );
    expect(result.commentBody).toContain('Invalid policy config: version must be 1.');
  });
});
