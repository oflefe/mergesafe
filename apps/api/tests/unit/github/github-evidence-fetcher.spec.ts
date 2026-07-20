import {
  EvidenceFetchError,
  GitHubEvidenceFetcher,
} from "../../../src/github/github-evidence-fetcher";
import { mapImpactedTests } from "../../../src/verification/test-impact";

function toBase64(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noBodyResponse(status: number): Response {
  return new Response("", { status });
}

describe("GitHubEvidenceFetcher", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = { ...envBackup };
    process.env.GITHUB_TOKEN = "token";
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it("paginates changed files endpoint", async () => {
    const fetcher = new GitHubEvidenceFetcher();

    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}?${url.searchParams.toString()}`;

      if (path.startsWith("/repos/o/r/pulls/10/commits")) {
        return jsonResponse([{ sha: "c1", commit: { message: "m1" } }]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/files")) {
        if (url.searchParams.get("page") === "1") {
          return jsonResponse(
            Array.from({ length: 100 }, (_, index) => ({
              filename: `src/file-${index}.ts`,
              status: "modified",
              additions: 1,
              deletions: 0,
            })),
          );
        }
        return jsonResponse([
          {
            filename: "src/final.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
          },
        ]);
      }
      if (path.startsWith("/repos/o/r/commits/head/check-runs")) {
        return jsonResponse({
          check_runs: [
            { name: "ci", status: "completed", conclusion: "success" },
          ],
        });
      }
      if (path.startsWith("/repos/o/r/commits/head/statuses")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/comments")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/issues/10/comments")) {
        return jsonResponse([]);
      }
      if (url.pathname === "/repos/o/r") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.pathname.includes("/contents/")) {
        return noBodyResponse(404);
      }
      if (url.pathname.startsWith("/repos/o/r/git/trees/")) {
        return jsonResponse({ tree: [] });
      }

      throw new Error(`Unhandled URL: ${url.toString()}`);
    });

    const evidence = await fetcher.fetchPullRequestEvidence(
      "o",
      "r",
      10,
      "head",
      "main",
      1,
    );

    expect(evidence.changedFiles).toHaveLength(101);
    expect(evidence.changedFiles[100].path).toBe("src/final.ts");
  });

  it("paginates issue and review comments endpoints", async () => {
    const fetcher = new GitHubEvidenceFetcher();

    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}?${url.searchParams.toString()}`;

      if (path.startsWith("/repos/o/r/pulls/10/commits")) {
        return jsonResponse([{ sha: "c1", commit: { message: "m1" } }]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/files")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/commits/head/check-runs")) {
        return jsonResponse({ check_runs: [] });
      }
      if (path.startsWith("/repos/o/r/commits/head/statuses")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/comments")) {
        if (url.searchParams.get("page") === "1") {
          return jsonResponse(
            Array.from({ length: 100 }, (_, id) => ({
              id,
              user: { login: "rv" },
              body: "r",
            })),
          );
        }
        return jsonResponse([{ id: 101, user: { login: "rv2" }, body: "r2" }]);
      }
      if (path.startsWith("/repos/o/r/issues/10/comments")) {
        if (url.searchParams.get("page") === "1") {
          return jsonResponse(
            Array.from({ length: 100 }, (_, id) => ({
              id: 1000 + id,
              user: { login: "is" },
              body: "i",
            })),
          );
        }
        return jsonResponse([{ id: 1200, user: { login: "is2" }, body: "i2" }]);
      }
      if (url.pathname === "/repos/o/r") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.pathname.includes("/contents/")) {
        return noBodyResponse(404);
      }
      if (url.pathname.startsWith("/repos/o/r/git/trees/")) {
        return jsonResponse({ tree: [] });
      }

      throw new Error(`Unhandled URL: ${url.toString()}`);
    });

    const evidence = await fetcher.fetchPullRequestEvidence(
      "o",
      "r",
      10,
      "head",
      "main",
      1,
    );

    expect(evidence.reviewComments).toHaveLength(202);
  });

  it("normalizes check runs and commit statuses together", async () => {
    const fetcher = new GitHubEvidenceFetcher();

    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}?${url.searchParams.toString()}`;

      if (path.startsWith("/repos/o/r/pulls/10/commits")) {
        return jsonResponse([{ sha: "c1", commit: { message: "m1" } }]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/files")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/commits/head/check-runs")) {
        return jsonResponse({
          check_runs: [
            { name: "unit", status: "completed", conclusion: "success" },
          ],
        });
      }
      if (path.startsWith("/repos/o/r/commits/head/statuses")) {
        return jsonResponse([
          { context: "lint", state: "failure" },
          { context: "build", state: "pending" },
        ]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/comments")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/issues/10/comments")) {
        return jsonResponse([]);
      }
      if (url.pathname === "/repos/o/r") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.pathname.includes("/contents/")) {
        return noBodyResponse(404);
      }
      if (url.pathname.startsWith("/repos/o/r/git/trees/")) {
        return jsonResponse({ tree: [] });
      }

      throw new Error(`Unhandled URL: ${url.toString()}`);
    });

    const evidence = await fetcher.fetchPullRequestEvidence(
      "o",
      "r",
      10,
      "head",
      "main",
      1,
    );

    expect(evidence.checkRuns).toEqual(
      expect.arrayContaining([
        { name: "unit", status: "completed", conclusion: "success" },
        { name: "lint", status: "completed", conclusion: "failure" },
        { name: "build", status: "queued", conclusion: null },
      ]),
    );
  });

  it("builds source content URL with encoded path and ref query parameter", async () => {
    const fetcher = new GitHubEvidenceFetcher();
    const seenUrls: string[] = [];

    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      seenUrls.push(url.toString());
      const path = `${url.pathname}?${url.searchParams.toString()}`;

      if (path.startsWith("/repos/o/r/pulls/10/commits")) {
        return jsonResponse([{ sha: "c1", commit: { message: "m1" } }]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/files")) {
        return jsonResponse([
          {
            filename: "src/a b.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
          },
        ]);
      }
      if (path.startsWith("/repos/o/r/commits/head/check-runs")) {
        return jsonResponse({ check_runs: [] });
      }
      if (path.startsWith("/repos/o/r/commits/head/statuses")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/comments")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/issues/10/comments")) {
        return jsonResponse([]);
      }
      if (url.pathname === "/repos/o/r") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.pathname.startsWith("/repos/o/r/git/trees/")) {
        return jsonResponse({ tree: [] });
      }
      if (
        url.pathname === "/repos/o/r/contents/src/a%20b.ts" &&
        url.searchParams.get("ref") === "head"
      ) {
        return jsonResponse({
          content: toBase64("export const x = 1;"),
          encoding: "base64",
        });
      }
      if (url.pathname.includes("/contents/")) {
        return noBodyResponse(404);
      }

      throw new Error(`Unhandled URL: ${url.toString()}`);
    });

    await fetcher.fetchPullRequestEvidence("o", "r", 10, "head", "main", 1);

    expect(seenUrls).toContain(
      "https://api.github.com/repos/o/r/contents/src/a%20b.ts?ref=head",
    );
  });

  it("fails closed in production when token cannot be resolved", async () => {
    const fetcher = new GitHubEvidenceFetcher();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_PRIVATE_KEY;
    process.env.NODE_ENV = "production";

    await expect(
      fetcher.fetchPullRequestEvidence("o", "r", 10, "head", "main", undefined),
    ).rejects.toBeInstanceOf(EvidenceFetchError);
  });

  it("allows empty evidence in explicit local or test mode when token is missing", async () => {
    const fetcher = new GitHubEvidenceFetcher();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_PRIVATE_KEY;
    process.env.NODE_ENV = "test";

    const evidence = await fetcher.fetchPullRequestEvidence(
      "o",
      "r",
      10,
      "head",
      "main",
      undefined,
    );

    expect(evidence).toEqual({
      commits: [],
      changedFiles: [],
      checkRuns: [],
      reviewComments: [],
      repositoryFiles: {},
      repositoryScripts: undefined,
      policyText: undefined,
      fetchFindings: [],
    });
  });

  it("fetches unchanged nearby tests and prevents false missing-test findings", async () => {
    const fetcher = new GitHubEvidenceFetcher();

    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}?${url.searchParams.toString()}`;

      if (path.startsWith("/repos/o/r/pulls/10/commits")) {
        return jsonResponse([{ sha: "c1", commit: { message: "m1" } }]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/files")) {
        return jsonResponse([
          {
            filename: "src/auth/session.ts",
            status: "modified",
            additions: 10,
            deletions: 2,
          },
        ]);
      }
      if (path.startsWith("/repos/o/r/commits/head/check-runs")) {
        return jsonResponse({ check_runs: [] });
      }
      if (path.startsWith("/repos/o/r/commits/head/statuses")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/pulls/10/comments")) {
        return jsonResponse([]);
      }
      if (path.startsWith("/repos/o/r/issues/10/comments")) {
        return jsonResponse([]);
      }
      if (url.pathname === "/repos/o/r") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url.pathname.startsWith("/repos/o/r/git/trees/")) {
        return jsonResponse({
          tree: [
            { path: "src/auth/session.ts", type: "blob" },
            { path: "tests/auth/session.spec.ts", type: "blob" },
          ],
        });
      }
      if (
        url.pathname === "/repos/o/r/contents/src/auth/session.ts" &&
        url.searchParams.get("ref") === "head"
      ) {
        return jsonResponse({
          content: toBase64("export const session = true;"),
          encoding: "base64",
        });
      }
      if (
        url.pathname === "/repos/o/r/contents/tests/auth/session.spec.ts" &&
        url.searchParams.get("ref") === "head"
      ) {
        return jsonResponse({
          content: toBase64(
            "import { session } from '../../src/auth/session';",
          ),
          encoding: "base64",
        });
      }
      if (url.pathname.includes("/contents/")) {
        return noBodyResponse(404);
      }

      throw new Error(`Unhandled URL: ${url.toString()}`);
    });

    const evidence = await fetcher.fetchPullRequestEvidence(
      "o",
      "r",
      10,
      "head",
      "main",
      1,
    );

    expect(
      evidence.repositoryFiles["tests/auth/session.spec.ts"],
    ).toBeDefined();

    const impact = mapImpactedTests(
      evidence.changedFiles,
      evidence.repositoryFiles,
    );
    expect(impact.impactedTests).toContain("tests/auth/session.spec.ts");
    expect(impact.missingTestCoverage).toEqual([]);
  });
});
