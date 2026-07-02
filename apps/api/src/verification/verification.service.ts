import { Injectable } from '@nestjs/common';
import { VerificationRequest, VerificationResult } from '../domain/types';
import { summarizeExternalFindings, buildVerificationComment, summarizeCi } from './report';
import { PolicyLoader } from './policy-loader';
import { evaluatePolicy } from './policy-evaluator';
import { scoreRisk } from './risk-scoring';
import { mapImpactedTests } from './test-impact';

@Injectable()
export class VerificationService {
  constructor(private readonly policyLoader: PolicyLoader) {}

  verify(request: VerificationRequest): VerificationResult {
    const policy = this.policyLoader.load(request.policyText);
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
      request.repositoryScripts,
    );
    const risk = scoreRisk(request, policy, testImpact);
    const policyEvaluation = evaluatePolicy(
      risk.riskFindings,
      testImpact,
      request.reviewComments,
      request.changedFiles.map((file) => file.path),
      policy,
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

    const verdict =
      policyEvaluation.policyFailures.length > 0 || risk.riskScore >= 80
        ? 'fail'
        : !ciPassed || risk.riskScore >= 35
          ? 'neutral'
          : 'pass';
    const checkConclusion =
      policyEvaluation.policyFailures.length > 0 ? 'failure' : verdict === 'pass' ? 'success' : 'neutral';

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
  }
}
