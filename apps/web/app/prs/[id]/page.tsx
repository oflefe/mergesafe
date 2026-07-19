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
          {verification.decisionTrace ? (
            <>
              <h2>PR scope</h2>
              <ul>
                <li>
                  {verification.decisionTrace.scope.totalFiles} files: {" "}
                  {verification.decisionTrace.scope.sourceFiles} source, {" "}
                  {verification.decisionTrace.scope.testFiles} test, {" "}
                  {verification.decisionTrace.scope.documentationFiles} documentation, {" "}
                  {verification.decisionTrace.scope.configurationFiles} configuration, {" "}
                  {verification.decisionTrace.scope.otherFiles} other
                </li>
                <li>
                  {verification.decisionTrace.scope.additions} additions, {" "}
                  {verification.decisionTrace.scope.deletions} deletions, {" "}
                  {verification.decisionTrace.scope.totalLineDelta} changed lines
                </li>
                <li>
                  Source-only delta: {" "}
                  {verification.decisionTrace.scope.sourceLineDelta} lines
                </li>
              </ul>
              <h2>Risk decision</h2>
              <p>
                {verification.decisionTrace.risk.score}/100 ({" "}
                {verification.decisionTrace.risk.level}) —{" "}
                {verification.decisionTrace.risk.evaluatedSignals.filter(
                  (signal: { triggered: boolean }) => signal.triggered,
                ).length} of {verification.decisionTrace.risk.evaluatedSignals.length}{" "}
                signals triggered.
              </p>
              <ul>
                {verification.decisionTrace.risk.evaluatedSignals.map(
                  (signal: {
                    code: string;
                    triggered: boolean;
                    reason: string;
                    weight: number;
                  }) => (
                    <li key={signal.code}>
                      {signal.triggered ? "Triggered" : "Not triggered"}: {signal.code} — {signal.reason} (+{signal.weight})
                    </li>
                  ),
                )}
              </ul>
              <h2>Test evidence</h2>
              <p>
                {verification.decisionTrace.tests.changedSourceFiles} changed source files: {" "}
                {verification.decisionTrace.tests.coveredSourceFiles} covered, {" "}
                {verification.decisionTrace.tests.uncoveredSourceFiles} uncovered.
              </p>
              <h2>CI decision</h2>
              <ul>
                <li>
                  {verification.decisionTrace.ci.passingChecks}/{verification.decisionTrace.ci.totalChecks} passing, {" "}
                  {verification.decisionTrace.ci.pendingChecks} pending, {" "}
                  {verification.decisionTrace.ci.failedChecks} failed or unsupported
                </li>
                {verification.decisionTrace.ci.reasons.map((reason: string) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <h2>Policy decision</h2>
              <p>
                Source: {verification.decisionTrace.policy.source}; {" "}
                {verification.decisionTrace.policy.rulesEvaluated} rules evaluated.
              </p>
              <ul>
                {verification.decisionTrace.policy.failures.length === 0 ? (
                  <li>No policy failures.</li>
                ) : (
                  verification.decisionTrace.policy.failures.map(
                    (failure: { code: string; message: string }) => (
                      <li key={failure.code}>{failure.message}</li>
                    ),
                  )
                )}
              </ul>
              <h2>Verdict explanation</h2>
              <ul>
                <li>
                  {verification.decisionTrace.verdict.verdict} ({" "}
                  {verification.decisionTrace.verdict.checkConclusion})
                </li>
                {verification.decisionTrace.verdict.reasons.length === 0 ? (
                  <li>No blocking reasons recorded.</li>
                ) : (
                  verification.decisionTrace.verdict.reasons.map(
                    (reason: { code: string; message: string }) => (
                      <li key={reason.code}>{reason.message}</li>
                    ),
                  )
                )}
              </ul>
            </>
          ) : null}
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
