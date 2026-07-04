import { TestImpactResult } from "../domain/types";

export function suggestTestCommands(
  testImpact: TestImpactResult,
  repositoryScripts: Record<string, string> = {},
): string[] {
  const unitTests = testImpact.impactedTests.filter(
    (path) => !/(integration|e2e|rollback)/i.test(path),
  );
  const integrationTests = testImpact.impactedTests.filter((path) =>
    /(integration|e2e|rollback)/i.test(path),
  );
  const commands: string[] = [];

  if (unitTests.length > 0) {
    if (repositoryScripts["test:unit"]) {
      commands.push(`npm run test:unit -- ${unitTests.join(" ")}`);
    } else if (repositoryScripts.test) {
      commands.push(`npm test -- ${unitTests.join(" ")}`);
    }
  }

  if (integrationTests.length > 0) {
    if (repositoryScripts["test:integration"]) {
      commands.push(
        `npm run test:integration -- ${integrationTests.join(" ")}`,
      );
    } else if (repositoryScripts.pytest) {
      commands.push(`pytest ${integrationTests.join(" ")}`);
    } else if (repositoryScripts.test) {
      commands.push(`npm test -- ${integrationTests.join(" ")}`);
    }
  }

  if (
    commands.length === 0 &&
    repositoryScripts.test &&
    testImpact.missingTestCoverage.length > 0
  ) {
    commands.push("npm test");
  }

  return commands;
}
