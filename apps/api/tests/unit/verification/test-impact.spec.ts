import { mapImpactedTests } from "../../../src/verification/test-impact";

describe("mapImpactedTests", () => {
  it("maps TypeScript imports back to unit and integration tests", () => {
    const result = mapImpactedTests([{ path: "src/auth/session.ts" }], {
      "src/auth/session.ts": `export const session = () => true;`,
      "src/auth/index.ts": `import { session } from '../../../src/verification/session';\nexport { session };`,
      "tests/auth/session.spec.ts": `import { session } from '../../../src/auth/session';\ndescribe('session', () => {});`,
      "tests/auth/session.integration.spec.ts": `import { session } from '../../../src/auth/index';\ndescribe('session integration', () => {});`,
    });

    expect(result.impactedTests).toEqual(
      expect.arrayContaining([
        "tests/auth/session.integration.spec.ts",
        "tests/auth/session.spec.ts",
      ]),
    );
    expect(result.suggestedCommands).toEqual([]);
  });

  it("maps Python imports and reports missing tests", () => {
    const mapped = mapImpactedTests([{ path: "src/app/security.py" }], {
      "src/app/security.py": "def validate():\n    return True\n",
      "tests/test_security.py":
        "from src.app.security import validate\n\ndef test_validate():\n    assert validate() is True\n",
    });

    expect(mapped.impactedTests).toContain("tests/test_security.py");

    const missing = mapImpactedTests([{ path: "src/app/payments.py" }], {
      "src/app/payments.py": "def charge():\n    return True\n",
    });

    expect(missing.missingTestCoverage).toEqual(["src/app/payments.py"]);
  });

  it("GIVEN multiple changed sources WHEN only one maps to a test THEN only uncovered sources are reported", () => {
    const result = mapImpactedTests(
      [
        { path: "src/patient.service.py" },
        { path: "src/billing_handler.py" },
      ],
      {
        "src/patient.service.py": "def patient():\n    return True\n",
        "src/billing_handler.py": "def billing():\n    return True\n",
        "tests/test_patient_service.py": "def test_patient():\n    assert True\n",
      },
    );

    expect(result.missingTestCoverage).toEqual(["src/billing_handler.py"]);
    expect(result.testMappings).toEqual([
      {
        sourceFile: "src/billing_handler.py",
        matchedTests: [],
        matchReasons: [],
      },
      {
        sourceFile: "src/patient.service.py",
        matchedTests: ["tests/test_patient_service.py"],
        matchReasons: ["same-stem"],
      },
    ]);
  });

  it("GIVEN a test directly imports a changed source WHEN mapping tests THEN it records direct dependency", () => {
    const result = mapImpactedTests([{ path: "src/auth/session.ts" }], {
      "src/auth/session.ts": "export const session = true;",
      "test/guard.spec.ts":
        "import { session } from '../../../src/src/auth/session';\ndescribe('guard', () => {});",
    });

    expect(result.testMappings).toContainEqual({
      sourceFile: "src/auth/session.ts",
      matchedTests: ["test/guard.spec.ts"],
      matchReasons: ["direct-dependent"],
    });
  });

  it("GIVEN a test reaches a changed source through an intermediate import WHEN mapping tests THEN it records transitive dependency", () => {
    const result = mapImpactedTests([{ path: "src/core/service.ts" }], {
      "src/core/service.ts": "export const service = true;",
      "src/core/index.ts":
        "import { service } from '../../../src/verification/service';\nexport { service };",
      "test/behavior.spec.ts":
        "import { service } from '../../../src/src/core/index';\ndescribe('behavior', () => {});",
    });

    expect(result.testMappings).toContainEqual({
      sourceFile: "src/core/service.ts",
      matchedTests: ["test/behavior.spec.ts"],
      matchReasons: ["transitive-dependent"],
    });
  });

  it("GIVEN a test shares a source filename stem WHEN mapping tests THEN it records same-stem", () => {
    const result = mapImpactedTests(
      [{ path: "src/billing/invoice.service.ts" }],
      {
        "src/billing/invoice.service.ts": "export const invoice = true;",
        "tests/billing/invoice.spec.ts": "describe('invoice', () => {});",
      },
    );

    expect(result.testMappings).toContainEqual({
      sourceFile: "src/billing/invoice.service.ts",
      matchedTests: ["tests/billing/invoice.spec.ts"],
      matchReasons: ["same-stem"],
    });
  });

  it("GIVEN a test is in the source directory WHEN mapping tests THEN it records nearby", () => {
    const result = mapImpactedTests(
      [{ path: "src/billing/invoice.service.ts" }],
      {
        "src/billing/invoice.service.ts": "export const invoice = true;",
        "src/billing/coverage_test.ts": "describe('coverage', () => {});",
      },
    );

    expect(result.testMappings).toContainEqual({
      sourceFile: "src/billing/invoice.service.ts",
      matchedTests: ["src/billing/coverage_test.ts"],
      matchReasons: ["nearby"],
    });
  });

  it("GIVEN a test is nested below the source directory WHEN mapping tests THEN it records nearby", () => {
    const result = mapImpactedTests(
      [{ path: "src/billing/invoice.ts" }],
      {
        "src/billing/invoice.ts": "export const invoice = true;",
        "src/billing/fixtures/random.spec.ts":
          "describe('random', () => {});",
      },
    );

    expect(result.testMappings).toContainEqual({
      sourceFile: "src/billing/invoice.ts",
      matchedTests: ["src/billing/fixtures/random.spec.ts"],
      matchReasons: ["nearby"],
    });
  });

  it("GIVEN a similarly named directory WHEN mapping tests THEN it does not record nearby", () => {
    const result = mapImpactedTests(
      [{ path: "src/billing/invoice.ts" }],
      {
        "src/billing/invoice.ts": "export const invoice = true;",
        "src/billing-v2/random.spec.ts": "describe('random', () => {});",
      },
    );

    expect(result.testMappings).toContainEqual({
      sourceFile: "src/billing/invoice.ts",
      matchedTests: [],
      matchReasons: [],
    });
  });

  it("GIVEN a root-level source file WHEN mapping tests THEN it does not match every test", () => {
    const result = mapImpactedTests(
      [{ path: "app.ts" }],
      {
        "app.ts": "export const app = true;",
        "tests/other.spec.ts": "describe('other', () => {});",
      },
    );

    expect(result.missingTestCoverage).toEqual(["app.ts"]);
    expect(result.testMappings).toContainEqual({
      sourceFile: "app.ts",
      matchedTests: [],
      matchReasons: [],
    });
  });

  it("GIVEN a short source stem WHEN mapping tests THEN it does not match unrelated stems", () => {
    const result = mapImpactedTests(
      [{ path: "src/a.ts" }],
      {
        "src/a.ts": "export const a = true;",
        "tests/payment-data.spec.ts": "describe('payment', () => {});",
      },
    );

    expect(result.missingTestCoverage).toEqual(["src/a.ts"]);
  });

  it("GIVEN a source stem contained in another stem WHEN mapping tests THEN it does not match the larger stem", () => {
    const result = mapImpactedTests(
      [{ path: "src/user.ts" }],
      {
        "src/user.ts": "export const user = true;",
        "tests/superuser.spec.ts": "describe('superuser', () => {});",
      },
    );

    expect(result.missingTestCoverage).toEqual(["src/user.ts"]);
  });

  it("GIVEN service source and plain test stems WHEN mapping tests THEN it records same-stem", () => {
    const result = mapImpactedTests(
      [{ path: "src/billing/invoice.service.ts" }],
      {
        "src/billing/invoice.service.ts": "export const invoice = true;",
        "tests/invoice.spec.ts": "describe('invoice', () => {});",
      },
    );

    expect(result.testMappings).toContainEqual({
      sourceFile: "src/billing/invoice.service.ts",
      matchedTests: ["tests/invoice.spec.ts"],
      matchReasons: ["same-stem"],
    });
  });

  it("GIVEN only false nearby or same-stem candidates WHEN mapping tests THEN it preserves missing coverage", () => {
    const result = mapImpactedTests(
      [{ path: "src/billing/invoice.ts" }],
      {
        "src/billing/invoice.ts": "export const invoice = true;",
        "src/billing-v2/invoice-history.spec.ts":
          "describe('invoice history', () => {});",
      },
    );

    expect(result.missingTestCoverage).toEqual(["src/billing/invoice.ts"]);
  });

  it("GIVEN one test matches through multiple mechanisms WHEN mapping tests THEN paths and reasons are deduplicated and sorted", () => {
    const result = mapImpactedTests(
      [{ path: "src/auth/session.ts" }],
      {
        "src/auth/session.ts": "export const session = true;",
        "src/auth/session.spec.ts":
          "import { session } from '../../../src/verification/session';\ndescribe('session', () => {});",
      },
    );

    expect(result.impactedTests).toEqual(["src/auth/session.spec.ts"]);
    expect(result.testMappings).toContainEqual({
      sourceFile: "src/auth/session.ts",
      matchedTests: ["src/auth/session.spec.ts"],
      matchReasons: ["direct-dependent", "nearby", "same-stem"],
    });
  });

  it("GIVEN a changed test file WHEN calculating impact THEN it is impacted but not missing coverage", () => {
    const result = mapImpactedTests([{ path: "tests/session.spec.ts" }]);

    expect(result.impactedTests).toEqual(["tests/session.spec.ts"]);
    expect(result.missingTestCoverage).toEqual([]);
    expect(result.testMappings).toEqual([
      {
        sourceFile: "tests/session.spec.ts",
        matchedTests: ["tests/session.spec.ts"],
        matchReasons: ["changed-test"],
      },
    ]);
  });

  it("GIVEN documentation-only changes WHEN calculating impact THEN no missing test evidence is reported", () => {
    const result = mapImpactedTests([
      { path: "README.md" },
      { path: "docs/verification.txt" },
    ]);

    expect(result.missingTestCoverage).toEqual([]);
    expect(result.testMappings).toEqual([]);
  });
});
