import { Injectable } from "@nestjs/common";
import {
  PullRequestTypeClassification,
  RiskLevel,
  TestImpactResult,
  Verdict,
  VerificationDecisionTrace,
  VerificationRequest,
  VerificationResult,
} from "../domain/types";
import { evaluateCiChecks } from "./ci-decision";
import { summarizeCiEvidence } from "./ci-evidence-summary";
import { classifyChangedFiles } from "./file-classification";
import { extractExternalReviewFindings } from "./external-review-findings";
import { PolicyConfigError, PolicyLoader } from "./policy-loader";
import { evaluatePolicy } from "./policy-evaluator";
import { renderVerificationReport } from "./report-renderer";
import { scoreRisk } from "./risk-scoring";
import { analyzePullRequestScope } from "./scope-analysis";
import { suggestTestCommands } from "./test-command-suggestion";
import { mapImpactedTests } from "./test-impact";
import { evaluateVerdict } from "./verdict-decision";

function buildTestDecisionTrace(
  changedFiles: VerificationRequest["changedFiles"],
  testImpact: TestImpactResult,
): VerificationDecisionTrace["tests"] {
  const sourcePaths = new Set(
    classifyChangedFiles(changedFiles)
      .filter((file) => file.kind === "source")
      .map((file) => file.path),
  );
  const sourceMappings = testImpact.testMappings.filter((mapping) =>
    sourcePaths.has(mapping.sourceFile),
  );

  return {
    changedSourceFiles: sourceMappings.length,
    coveredSourceFiles: sourceMappings.filter(
      (mapping) => mapping.matchedTests.length > 0,
    ).length,
    uncoveredSourceFiles: sourceMappings.filter(
      (mapping) => mapping.matchedTests.length === 0,
    ).length,
    impactedTests: testImpact.impactedTests,
    missingTestCoverage: testImpact.missingTestCoverage,
    testMappings: testImpact.testMappings,
  };
}

@Injectable()
export class VerificationService {
  constructor(private readonly policyLoader: PolicyLoader) {}

  verify(
    request: VerificationRequest,
    prClassification?: PullRequestTypeClassification,
  ): VerificationResult {
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
    const ciEvaluation = evaluateCiChecks(request.checkRuns);
    const ciPassed = ciEvaluation.passed;
    const scope = analyzePullRequestScope(request.changedFiles);
    const testDecisionTrace = buildTestDecisionTrace(
      request.changedFiles,
      testImpact,
    );
    const externalReviewFindings = extractExternalReviewFindings(
      request.reviewComments,
    );
    const ciSummary = summarizeCiEvidence(request.checkRuns, ciPassed);

    try {
      const loadedPolicy = this.policyLoader.loadWithSource(request.policyText);
      const policy = loadedPolicy.policy;
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

      const verdictDecision = evaluateVerdict({
        riskLevel: risk.riskLevel,
        policyFailures: policyEvaluation.policyFailures,
        ci: ciEvaluation.decisionTrace,
      });
      const decisionTrace: VerificationDecisionTrace = {
        scope,
        ...(prClassification ? { prClassification } : {}),
        risk: {
          score: risk.riskScore,
          level: risk.riskLevel,
          contributions: risk.riskFindings,
          evaluatedSignals: risk.evaluatedSignals,
        },
        tests: testDecisionTrace,
        ci: ciEvaluation.decisionTrace,
        policy: {
          source: loadedPolicy.source,
          rulesEvaluated: policy.rules.length,
          failures: policyEvaluation.policyFailures,
        },
        verdict: verdictDecision,
      };

      const commentBody = renderVerificationReport({
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        verdict: verdictDecision.verdict,
        riskFindings: risk.riskFindings,
        uncategorizedFiles: risk.uncategorizedFiles,
        verificationRequirements,
        suggestedCommands: testImpact.suggestedCommands,
        missingTests: testImpact.missingTestCoverage,
        externalReviewFindings,
        ciSummary,
        decisionTrace,
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
        verdict: verdictDecision.verdict,
        checkConclusion: verdictDecision.checkConclusion,
        decisionTrace,
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
      const invalidPolicyFailures = [
        {
          code: "policy-config-invalid",
          verdict: Verdict.FAIL,
          message: failureMessage,
        },
      ];
      const verdictDecision = evaluateVerdict({
        riskLevel: RiskLevel.LOW,
        policyFailures: invalidPolicyFailures,
        ci: ciEvaluation.decisionTrace,
      });
      const decisionTrace: VerificationDecisionTrace = {
        scope,
        ...(prClassification ? { prClassification } : {}),
        risk: {
          score: 0,
          level: RiskLevel.LOW,
          contributions: [],
          evaluatedSignals: [],
        },
        tests: testDecisionTrace,
        ci: ciEvaluation.decisionTrace,
        policy: {
          source: "repository",
          rulesEvaluated: 0,
          failures: invalidPolicyFailures,
        },
        verdict: verdictDecision,
      };
      const commentBody = renderVerificationReport({
        riskScore: 0,
        riskLevel: RiskLevel.LOW,
        verdict: verdictDecision.verdict,
        riskFindings: [],
        uncategorizedFiles: [],
        verificationRequirements,
        suggestedCommands: testImpact.suggestedCommands,
        missingTests: testImpact.missingTestCoverage,
        externalReviewFindings,
        ciSummary,
        decisionTrace,
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
        policyFailures: invalidPolicyFailures,
        verificationRequirements,
        externalReviewFindings,
        ciPassed,
        ciSummary,
        likelyAgentAuthored: false,
        commentBody,
        verdict: verdictDecision.verdict,
        checkConclusion: verdictDecision.checkConclusion,
        decisionTrace,
      };
    }
  }
}
