import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { VerificationPolicy } from '../domain/types';

const defaultPolicy: VerificationPolicy = {
  heuristics: {
    branchIndicators: ['copilot', 'claude', 'cursor', 'codex', 'ai', 'agent'],
  },
  riskWeights: {
    agentAuthored: 18,
    auth: 30,
    payment: 30,
    migration: 24,
    env: 18,
    dependencyLockfile: 12,
    infrastructure: 20,
    apiContract: 18,
    missingTests: 22,
    largePr: 16,
    generatedText: 14,
  },
  hardRules: {
    authChangeRequiresIntegrationTest: true,
    migrationRequiresRollbackTest: true,
    envChangeRequiresDocsUpdate: true,
    paymentChangeRequiresManualReviewer: true,
  },
};

@Injectable()
export class PolicyLoader {
  load(policyText?: string): VerificationPolicy {
    const fileText =
      policyText ??
      (existsSync(this.localPath()) ? readFileSync(this.localPath(), 'utf8') : undefined);
    if (!fileText) {
      return defaultPolicy;
    }

    const parsed = parse(fileText) as Partial<VerificationPolicy> | null;
    return {
      heuristics: {
        branchIndicators:
          parsed?.heuristics?.branchIndicators ?? defaultPolicy.heuristics.branchIndicators,
      },
      riskWeights: {
        ...defaultPolicy.riskWeights,
        ...(parsed?.riskWeights ?? {}),
      },
      hardRules: {
        ...defaultPolicy.hardRules,
        ...(parsed?.hardRules ?? {}),
      },
    };
  }

  private localPath(): string {
    return resolve(process.cwd(), '.agent-pr-verifier.yml');
  }
}
