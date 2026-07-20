import { analyzePullRequestScope } from "../../../src/verification/scope-analysis";

describe("analyzePullRequestScope", () => {
  it("GIVEN a mixed pull request WHEN analyzing scope THEN it reports file and line metrics by kind", () => {
    expect(
      analyzePullRequestScope([
        { path: "src/app.ts", additions: 10, deletions: 2 },
        { path: "src/app.spec.ts", additions: 4, deletions: 1 },
        { path: "README.md", additions: 2, deletions: 0 },
        { path: "Dockerfile", additions: 3, deletions: 3 },
        { path: "public/logo.svg", additions: 1, deletions: 0 },
      ]),
    ).toEqual({
      totalFiles: 5,
      sourceFiles: 1,
      testFiles: 1,
      documentationFiles: 1,
      configurationFiles: 1,
      otherFiles: 1,
      additions: 20,
      deletions: 6,
      totalLineDelta: 26,
      sourceAdditions: 10,
      sourceDeletions: 2,
      sourceLineDelta: 12,
    });
  });

  it("GIVEN duplicate paths WHEN analyzing scope THEN each path contributes once", () => {
    expect(
      analyzePullRequestScope([
        { path: "src/app.ts", additions: 3, deletions: 1 },
        { path: "src/app.ts", additions: 3, deletions: 1 },
        { path: "src/app.ts", additions: 5, deletions: 2 },
      ]),
    ).toEqual({
      totalFiles: 1,
      sourceFiles: 1,
      testFiles: 0,
      documentationFiles: 0,
      configurationFiles: 0,
      otherFiles: 0,
      additions: 5,
      deletions: 2,
      totalLineDelta: 7,
      sourceAdditions: 5,
      sourceDeletions: 2,
      sourceLineDelta: 7,
    });
  });

  it("GIVEN files without line counts WHEN analyzing scope THEN missing counts are zero", () => {
    expect(analyzePullRequestScope([{ path: "src/app.ts" }])).toMatchObject({
      totalFiles: 1,
      additions: 0,
      deletions: 0,
      totalLineDelta: 0,
      sourceLineDelta: 0,
    });
  });
});
