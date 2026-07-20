import { CheckRunSnapshot } from "../../../src/domain/types";
import { evaluateCiChecks } from "../../../src/verification/ci-decision";

describe("evaluateCiChecks", () => {
  it("GIVEN no checks WHEN evaluating CI THEN it fails with a no-check reason", () => {
    const result = evaluateCiChecks([]);

    expect(result.passed).toBe(false);
    expect(result.decisionTrace).toMatchObject({
      totalChecks: 0,
      passingChecks: 0,
      pendingChecks: 0,
      failedChecks: 0,
      reasons: ["No CI checks were reported."],
    });
  });

  it("GIVEN successful checks WHEN evaluating CI THEN it passes", () => {
    const result = evaluateCiChecks([
      { name: "unit", status: "completed", conclusion: "success" },
      { name: "lint", status: "completed", conclusion: "success" },
    ]);

    expect(result.passed).toBe(true);
    expect(result.decisionTrace).toMatchObject({
      totalChecks: 2,
      passingChecks: 2,
      pendingChecks: 0,
      failedChecks: 0,
      reasons: ["All reported CI checks are passing or accepted as neutral/skipped."],
    });
  });

  it("GIVEN neutral and skipped checks WHEN evaluating CI THEN both are accepted", () => {
    const result = evaluateCiChecks([
      { name: "neutral", status: "completed", conclusion: "neutral" },
      { name: "skipped", status: "completed", conclusion: "skipped" },
    ]);

    expect(result.passed).toBe(true);
    expect(result.decisionTrace.passingChecks).toBe(2);
  });

  it("GIVEN a pending check WHEN evaluating CI THEN it reports pending", () => {
    const result = evaluateCiChecks([
      { name: "unit", status: "completed", conclusion: "success" },
      { name: "integration", status: "in_progress", conclusion: null },
    ]);

    expect(result.passed).toBe(false);
    expect(result.decisionTrace).toMatchObject({
      passingChecks: 1,
      pendingChecks: 1,
      failedChecks: 0,
      reasons: ["1 CI check is still pending."],
    });
  });

  it("GIVEN a failed check WHEN evaluating CI THEN it reports failure", () => {
    const result = evaluateCiChecks([
      { name: "unit", status: "completed", conclusion: "failure" },
    ]);

    expect(result.passed).toBe(false);
    expect(result.decisionTrace).toMatchObject({
      failedChecks: 1,
      reasons: ["1 CI check has failed."],
    });
  });

  it("GIVEN a cancelled check WHEN evaluating CI THEN it reports cancellation", () => {
    const result = evaluateCiChecks([
      { name: "unit", status: "completed", conclusion: "cancelled" },
    ]);

    expect(result.passed).toBe(false);
    expect(result.decisionTrace).toMatchObject({
      failedChecks: 1,
      reasons: ["1 CI check is cancelled."],
    });
  });

  it("GIVEN an unsupported conclusion WHEN evaluating CI THEN it reports the unsupported result", () => {
    const result = evaluateCiChecks([
      {
        name: "unit",
        status: "completed",
        conclusion: "timed_out",
      } as unknown as CheckRunSnapshot,
    ]);

    expect(result.passed).toBe(false);
    expect(result.decisionTrace).toMatchObject({
      failedChecks: 1,
      reasons: ["1 CI check has an unsupported conclusion."],
    });
  });

  it("GIVEN checks in varying input order WHEN evaluating CI THEN trace checks are sorted", () => {
    const checks: CheckRunSnapshot[] = [
      { name: "z", status: "completed", conclusion: "success" },
      { name: "a", status: "completed", conclusion: "success" },
    ];

    expect(evaluateCiChecks(checks).decisionTrace.checks.map((check) => check.name)).toEqual([
      "a",
      "z",
    ]);
  });
});
