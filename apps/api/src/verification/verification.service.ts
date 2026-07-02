import { Injectable } from '@nestjs/common';
import { VerificationRequest, VerificationResult } from '../domain/types';
import { summarizeExternalFindings, buildVerificationComment, summarizeCi } from './report';
import { PolicyConfigError, PolicyLoader } from './policy-loader';
import { evaluatePolicy } from './policy-evaluator';
import { scoreRisk } from './risk-scoring';
import { mapImpactedTests } from './test-impact';

@Injectable()
export class VerificationService {
  constructor(private readonly policyLoader: PolicyLoader) {}

  verify(request: VerificationRequest): VerificationResult {
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
      request.repositoryScripts,
    );
    const ciPassed =
      request.checkRuns.length > 0 &&
      request.checkRuns.every(
        (checkRun) =>
          checkRun.conclusion === 'success' ||
          checkRun.conclusion === 'neutral' ||
          checkRun.conclusion === 'skipped',
      );
    const externalReviewFindings = summarizeExternalFindings(request.reviewComments);
    const ciSummary = summarizeCi(
      testImpact.suggestedCommands,
      ciPassed,
      request.checkRuns.map((checkRun) => ({
        name: checkRun.name,
        conclusion: checkRun.conclusion,
      })),
    );

    try {
      const policy = this.policyLoader.load(request.policyText);
      const risk = scoreRisk(request, policy, testImpact);
      const policyEvaluation = evaluatePolicy(
        testImpact,
        request.reviewComments,
        request.changedFiles.map((file) => file.path),
        policy,
      );

      const verificationRequirements = [...policyEvaluation.verificationRequirements];
      if (risk.riskFindings.some((finding) => finding.code === 'missing-tests')) {
        verificationRequirements.push({
          code: 'add-tests',
          message: 'Add or update tests that exercise the changed code paths.',
        });
      }
      if (!ciPassed) {
        verificationRequirements.push({
          code: 'green-ci',
          message: 'Get existing CI checks to a passing state before merge.',
        });
      }

      const policyFailureVerdict = policyEvaluation.policyFailures.some(
        (failure) => failure.verdict === 'fail',
      )
        ? 'fail'
        : policyEvaluation.policyFailures.some((failure) => failure.verdict === 'needs_review')
          ? 'neutral'
          : 'pass';
      const verdict =
        policyFailureVerdict === 'fail' || risk.riskScore >= 80
          ? 'fail'
          : policyFailureVerdict === 'neutral' || !ciPassed || risk.riskScore >= 35
            ? 'neutral'
            : 'pass';
      const checkConclusion =
        policyEvaluation.policyFailures.some((failure) => failure.verdict === 'fail') ||
        risk.riskScore >= 80
          ? 'failure'
          : verdict === 'pass'
            ? 'success'
            : 'neutral';

      const commentBody = buildVerificationComment({
        riskScore: risk.riskScore,
        verdict,
        riskFindings: risk.riskFindings,
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
        riskFindings: risk.riskFindings,
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
          code: 'policy-config-invalid',
          message: failureMessage,
        },
      ];
      const commentBody = buildVerificationComment({
        riskScore: 0,
        verdict: 'fail',
        riskFindings: [],
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
        riskFindings: [],
        testImpact,
        policyFailures: [
          {
            code: 'policy-config-invalid',
            verdict: 'fail',
            message: failureMessage,
          },
        ],
        verificationRequirements,
        externalReviewFindings,
        ciPassed,
        ciSummary,
        likelyAgentAuthored: false,
        commentBody,
        verdict: 'fail',
        checkConclusion: 'failure',
      };
    }
  }
}
