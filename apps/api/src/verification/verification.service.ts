import { Injectable } from "@nestjs/common";
import {
  RiskLevel,
  Verdict,
  VerificationRequest,
  VerificationResult,
} from "../domain/types";
import { summarizeCiEvidence } from "./ci-evidence-summary";
import { extractExternalReviewFindings } from "./external-review-findings";
import { PolicyConfigError, PolicyLoader } from "./policy-loader";
import { evaluatePolicy } from "./policy-evaluator";
import { renderVerificationReport } from "./report-renderer";
import { scoreRisk } from "./risk-scoring";
import { suggestTestCommands } from "./test-command-suggestion";
import { mapImpactedTests } from "./test-impact";

@Injectable()
export class VerificationService {
  constructor(private readonly policyLoader: PolicyLoader) {}

  verify(request: VerificationRequest): VerificationResult {
    const testImpactMapping = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );
    const suggestedCommands = suggestTestCommands(
      testImpactMapping,
      request.repositoryScripts,
    );
    const testImpact = {
      ...testImpactMapping,
      suggestedCommands,
    };
    const ciPassed =
      request.checkRuns.length > 0 &&
      request.checkRuns.every(
        (checkRun) =>
          checkRun.conclusion === "success" ||
          checkRun.conclusion === "neutral" ||
          checkRun.conclusion === "skipped",
      );
    const externalReviewFindings = extractExternalReviewFindings(
      request.reviewComments,
    );
    const ciSummary = summarizeCiEvidence(request.checkRuns, ciPassed);

    try {
      const policy = this.policyLoader.load(request.policyText);
      const risk = scoreRisk(request, policy, testImpact);
      const policyEvaluation = evaluatePolicy(
        testImpact,
        request.reviewComments,
        request.changedFiles.map((file) => file.path),
        policy,
      );

      const verificationRequirements = [
        ...policyEvaluation.verificationRequirements,
      ];
      if (
        risk.riskFindings.some((finding) => finding.code === "missing-tests")
      ) {
        verificationRequirements.push({
          code: "add-tests",
          message: "Add or update tests that exercise the changed code paths.",
        });
      }
      if (!ciPassed) {
        verificationRequirements.push({
          code: "green-ci",
          message: "Get existing CI checks to a passing state before merge.",
        });
      }

      const policyFailureVerdict = policyEvaluation.policyFailures.some(
        (failure) => failure.verdict === Verdict.FAIL,
      )
        ? Verdict.FAIL
        : policyEvaluation.policyFailures.some(
              (failure) => failure.verdict === Verdict.NEEDS_REVIEW,
            )
          ? Verdict.NEEDS_REVIEW
          : Verdict.PASS;
      const verdict =
        policyFailureVerdict === Verdict.FAIL ||
        risk.riskLevel === RiskLevel.CRITICAL
          ? Verdict.FAIL
          : policyFailureVerdict === Verdict.NEEDS_REVIEW ||
              !ciPassed ||
              risk.riskLevel === RiskLevel.HIGH ||
              risk.riskLevel === RiskLevel.MEDIUM
            ? Verdict.NEEDS_REVIEW
            : Verdict.PASS;
      const checkConclusion =
        policyEvaluation.policyFailures.some(
          (failure) => failure.verdict === Verdict.FAIL,
        ) || risk.riskLevel === RiskLevel.CRITICAL
          ? "failure"
          : verdict === Verdict.PASS
            ? "success"
            : "neutral";

      const commentBody = renderVerificationReport({
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        verdict,
        riskFindings: risk.riskFindings,
        uncategorizedFiles: risk.uncategorizedFiles,
        verificationRequirements,
        suggestedCommands: testImpact.suggestedCommands,
        missingTests: testImpact.missingTestCoverage,
        externalReviewFindings,
        ciSummary,
      });

      return {
        pullRequestId: `${request.repoId}#${request.pullNumber}`,
        repoId: request.repoId,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        riskFindings: risk.riskFindings,
        riskDiagnostics: {
          uncategorizedFiles: risk.uncategorizedFiles,
        },
        testImpact,
        policyFailures: policyEvaluation.policyFailures,
        verificationRequirements,
        externalReviewFindings,
        ciPassed,
        ciSummary,
        likelyAgentAuthored: risk.likelyAgentAuthored,
        commentBody,
        verdict,
        checkConclusion,
      };
    } catch (error) {
      if (!(error instanceof PolicyConfigError)) {
        throw error;
      }

      const failureMessage = error.message;
      const verificationRequirements = [
        {
          code: "policy-config-invalid",
          message: failureMessage,
        },
      ];
      const commentBody = renderVerificationReport({
        riskScore: 0,
        riskLevel: RiskLevel.LOW,
        verdict: Verdict.FAIL,
        riskFindings: [],
        uncategorizedFiles: [],
        verificationRequirements,
        suggestedCommands: testImpact.suggestedCommands,
        missingTests: testImpact.missingTestCoverage,
        externalReviewFindings,
        ciSummary,
      });

      return {
        pullRequestId: `${request.repoId}#${request.pullNumber}`,
        repoId: request.repoId,
        riskScore: 0,
        riskLevel: RiskLevel.LOW,
        riskFindings: [],
        riskDiagnostics: {
          uncategorizedFiles: [],
        },
        testImpact,
        policyFailures: [
          {
            code: "policy-config-invalid",
            verdict: Verdict.FAIL,
            message: failureMessage,
          },
        ],
        verificationRequirements,
        externalReviewFindings,
        ciPassed,
        ciSummary,
        likelyAgentAuthored: false,
        commentBody,
        verdict: Verdict.FAIL,
        checkConclusion: "failure",
      };
    }
  }
}
