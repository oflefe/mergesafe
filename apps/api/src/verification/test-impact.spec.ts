import { mapImpactedTests } from './test-impact';

describe('mapImpactedTests', () => {
  it('maps TypeScript imports back to unit and integration tests', () => {
    const result = mapImpactedTests(
      [{ path: 'src/auth/session.ts' }],
      {
        'src/auth/session.ts': `export const session = () => true;`,
        'src/auth/index.ts': `import { session } from './session';\nexport { session };`,
        'tests/auth/session.spec.ts': `import { session } from '../../src/auth/session';\ndescribe('session', () => {});`,
        'tests/auth/session.integration.spec.ts': `import { session } from '../../src/auth/index';\ndescribe('session integration', () => {});`,
      },
    );

    expect(result.impactedTests).toEqual(
      expect.arrayContaining([
        'tests/auth/session.integration.spec.ts',
        'tests/auth/session.spec.ts',
      ]),
    );
    expect(result.suggestedCommands).toEqual([]);
  });

  it('maps Python imports and reports missing tests', () => {
    const mapped = mapImpactedTests(
      [{ path: 'src/app/security.py' }],
      {
        'src/app/security.py': 'def validate():\n    return True\n',
        'tests/test_security.py': 'from src.app.security import validate\n\ndef test_validate():\n    assert validate() is True\n',
      },
    );

    expect(mapped.impactedTests).toContain('tests/test_security.py');

    const missing = mapImpactedTests(
      [{ path: 'src/app/payments.py' }],
      {
        'src/app/payments.py': 'def charge():\n    return True\n',
      },
    );

    expect(missing.missingTestCoverage).toEqual(['src/app/payments.py']);
  });
});
