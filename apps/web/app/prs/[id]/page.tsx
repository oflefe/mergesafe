import { fetchApiJson } from "../../../lib/api-client";

export const dynamic = "force-dynamic";

async function loadVerification(id: string) {
  try {
    const encodedId = encodeURIComponent(id);
    const verification = await fetchApiJson<any>(
      `/prs/${encodedId}/verification`,
    );

    if (!verification) {
      return null;
    }

    return verification;
  } catch {
    return null;
  }
}

export default async function PullRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pullRequestId = decodeURIComponent(id);
  const verification = await loadVerification(pullRequestId);

  return (
    <section>
      <h1>{pullRequestId}</h1>
      {verification ? (
        <>
          <p>
            Verdict: <strong>{verification.verdict}</strong> — Risk score{" "}
            {verification.riskScore}/100
          </p>
          <h2>Required verification</h2>
          <ul>
            {verification.verificationRequirements.map(
              (requirement: { code: string; message: string }) => (
                <li key={requirement.code}>{requirement.message}</li>
              ),
            )}
          </ul>
          <h2>Suggested test commands</h2>
          <ul>
            {verification.testImpact.suggestedCommands.map(
              (command: string) => (
                <li key={command}>
                  <code>{command}</code>
                </li>
              ),
            )}
          </ul>
          <h2>AI review findings</h2>
          <ul>
            {verification.externalReviewFindings.length === 0 ? (
              <li>No unresolved AI review findings.</li>
            ) : (
              verification.externalReviewFindings.map(
                (finding: { source: string; body: string }) => (
                  <li key={`${finding.source}-${finding.body}`}>
                    [{finding.source}] {finding.body}
                  </li>
                ),
              )
            )}
          </ul>
        </>
      ) : (
        <p>No verification run found.</p>
      )}
    </section>
  );
}
