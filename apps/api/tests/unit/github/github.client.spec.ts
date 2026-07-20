import { GitHubAppClient } from "../../../src/github/github.client";
import {
  RiskLevel,
  VerificationRequest,
  VerificationResult,
  Verdict,
} from "../../../src/domain/types";
import { safeDocsPr } from "../../fixtures/pull-request.fixtures";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildRequest(
  overrides: Partial<VerificationRequest> = {},
): VerificationRequest {
  return {
    ...safeDocsPr,
    installationId: 42,
    ...overrides,
  };
}

function buildResult(
  overrides: Partial<VerificationResult> = {},
): VerificationResult {
  return {
    pullRequestId: "octo/demo#1",
    repoId: "octo/demo",
    riskScore: 25,
    riskLevel: RiskLevel.MEDIUM,
    riskFindings: [],
    testImpact: {
      impactedTests: [],
      missingTestCoverage: [],
      suggestedCommands: ["npm test"],
      testMappings: [],
    },
    riskDiagnostics: { uncategorizedFiles: [] },
    policyFailures: [],
    verificationRequirements: [],
    externalReviewFindings: [],
    ciPassed: true,
    ciSummary: "CI passed",
    likelyAgentAuthored: false,
    commentBody: "MergeSafe body",
    verdict: Verdict.PASS,
    checkConclusion: "success",
    ...overrides,
  };
}

describe("GitHubAppClient", () => {
  let client: GitHubAppClient;

  beforeEach(() => {
    client = new GitHubAppClient();
    jest
      .spyOn(client as any, "getInstallationToken")
      .mockResolvedValue("token-secret-value");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("GIVEN no existing marker comment WHEN posting verification THEN it creates one comment", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const method = (init?.method ?? "GET").toUpperCase();

        if (
          method === "GET" &&
          url.pathname === "/repos/octo/demo/issues/1/comments" &&
          url.searchParams.get("per_page") === "100" &&
          url.searchParams.get("page") === "1"
        ) {
          return jsonResponse([]);
        }

        if (
          method === "POST" &&
          url.pathname === "/repos/octo/demo/issues/1/comments"
        ) {
          return jsonResponse({ id: 901 });
        }

        throw new Error(`Unhandled URL: ${url.toString()} ${method}`);
      });

    const commentId = await client.upsertVerificationComment(
      buildRequest(),
      "Verification text",
    );

    expect(commentId).toBe(901);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const createCall = fetchMock.mock.calls.find(([, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      return method === "POST";
    });

    expect(createCall).toBeDefined();
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body.body).toContain("<!-- mergesafe-verification -->");
    expect(body.body).toContain("Verification text");
  });

  it("GIVEN an existing comment id WHEN posting verification again THEN it updates same comment", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const method = (init?.method ?? "GET").toUpperCase();

        if (
          method === "PATCH" &&
          url.pathname === "/repos/octo/demo/issues/comments/901"
        ) {
          return jsonResponse({ id: 901 });
        }

        throw new Error(`Unhandled URL: ${url.toString()} ${method}`);
      });

    const commentId = await client.upsertVerificationComment(
      buildRequest(),
      "Verification text",
      901,
    );

    expect(commentId).toBe(901);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const patchBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(patchBody.body).toContain("<!-- mergesafe-verification -->");
  });

  it("GIVEN stored id is missing after restart WHEN marker exists in PR comments THEN it updates marker comment", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const method = (init?.method ?? "GET").toUpperCase();

        if (
          method === "GET" &&
          url.pathname === "/repos/octo/demo/issues/1/comments"
        ) {
          return jsonResponse([
            { id: 1, body: "regular comment" },
            { id: 777, body: "<!-- mergesafe-verification -->\nold" },
          ]);
        }

        if (
          method === "PATCH" &&
          url.pathname === "/repos/octo/demo/issues/comments/777"
        ) {
          return jsonResponse({ id: 777 });
        }

        throw new Error(`Unhandled URL: ${url.toString()} ${method}`);
      });

    const commentId = await client.upsertVerificationComment(
      buildRequest(),
      "New verification text",
    );

    expect(commentId).toBe(777);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const postCall = fetchMock.mock.calls.find(([, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      return method === "POST";
    });
    expect(postCall).toBeUndefined();
  });

  it("GIVEN a pull request head SHA WHEN creating check run THEN it uses exact head SHA", async () => {
    const request = buildRequest({ headSha: "exact-head-sha" });
    const result = buildResult();

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const method = (init?.method ?? "GET").toUpperCase();

        if (
          method === "GET" &&
          url.pathname === "/repos/octo/demo/commits/exact-head-sha/check-runs"
        ) {
          return jsonResponse({ check_runs: [] });
        }

        if (
          method === "POST" &&
          url.pathname === "/repos/octo/demo/check-runs"
        ) {
          return jsonResponse({ id: 321 });
        }

        throw new Error(`Unhandled URL: ${url.toString()} ${method}`);
      });

    const checkRunId = await client.createOrUpdateCheckRun(request, result);

    expect(checkRunId).toBe(321);
    const createCall = fetchMock.mock.calls.find(([, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      return method === "POST";
    });
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body.name).toBe("MergeSafe Verification");
    expect(body.head_sha).toBe("exact-head-sha");
  });

  it("GIVEN same head SHA WHEN check run already exists THEN it updates existing check run", async () => {
    const request = buildRequest({ headSha: "same-head" });
    const result = buildResult();

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const method = (init?.method ?? "GET").toUpperCase();

        if (
          method === "GET" &&
          url.pathname === "/repos/octo/demo/commits/same-head/check-runs"
        ) {
          return jsonResponse({
            check_runs: [
              {
                id: 654,
                name: "MergeSafe Verification",
                head_sha: "same-head",
              },
            ],
          });
        }

        if (
          method === "PATCH" &&
          url.pathname === "/repos/octo/demo/check-runs/654"
        ) {
          return jsonResponse({ id: 654 });
        }

        throw new Error(`Unhandled URL: ${url.toString()} ${method}`);
      });

    const checkRunId = await client.createOrUpdateCheckRun(request, result);

    expect(checkRunId).toBe(654);
    const postCall = fetchMock.mock.calls.find(([, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      return method === "POST";
    });
    expect(postCall).toBeUndefined();
  });

  it("GIVEN a new head SHA WHEN no check run exists for that SHA THEN it creates a new check run", async () => {
    const request = buildRequest({ headSha: "new-head" });
    const result = buildResult();

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const method = (init?.method ?? "GET").toUpperCase();

        if (
          method === "GET" &&
          url.pathname === "/repos/octo/demo/commits/new-head/check-runs"
        ) {
          return jsonResponse({ check_runs: [] });
        }

        if (
          method === "POST" &&
          url.pathname === "/repos/octo/demo/check-runs"
        ) {
          return jsonResponse({ id: 987 });
        }

        throw new Error(`Unhandled URL: ${url.toString()} ${method}`);
      });

    const checkRunId = await client.createOrUpdateCheckRun(request, result);

    expect(checkRunId).toBe(987);
    const postCalls = fetchMock.mock.calls.filter(([, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      return method === "POST";
    });
    expect(postCalls).toHaveLength(1);
  });

  it("GIVEN a GitHub API failure WHEN comment upsert fails THEN it returns clear error without token leakage", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();

      if (
        method === "GET" &&
        url.pathname === "/repos/octo/demo/issues/1/comments"
      ) {
        return jsonResponse({ message: "forbidden" }, 403);
      }

      throw new Error(`Unhandled URL: ${url.toString()} ${method}`);
    });

    await expect(
      client.upsertVerificationComment(buildRequest(), "body"),
    ).rejects.toThrow("GitHub API request failed (403)");

    await expect(
      client.upsertVerificationComment(buildRequest(), "body"),
    ).rejects.not.toThrow("token-secret-value");
  });
});
