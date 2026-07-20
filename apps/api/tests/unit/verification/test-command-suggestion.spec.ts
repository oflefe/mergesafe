import { suggestTestCommands } from "../../../src/verification/test-command-suggestion";

describe("suggestTestCommands", () => {
  it("builds unit and integration commands from mapped tests", () => {
    const commands = suggestTestCommands(
      {
        impactedTests: [
          "tests/auth/session.integration.spec.ts",
          "tests/auth/session.spec.ts",
        ],
        missingTestCoverage: [],
        suggestedCommands: [],
        testMappings: [],
      },
      {
        test: "jest",
        "test:unit": "jest unit",
        "test:integration": "jest integration",
      },
    );

    expect(commands).toEqual(
      expect.arrayContaining([
        "npm run test:unit -- tests/auth/session.spec.ts",
        "npm run test:integration -- tests/auth/session.integration.spec.ts",
      ]),
    );
  });

  it("falls back to npm test when coverage is missing", () => {
    const commands = suggestTestCommands(
      {
        impactedTests: [],
        missingTestCoverage: ["src/auth/session.ts"],
        suggestedCommands: [],
        testMappings: [],
      },
      { test: "jest" },
    );

    expect(commands).toEqual(["npm test"]);
  });
});
