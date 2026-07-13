import { Injectable } from "@nestjs/common";
import { parse } from "yaml";
import {
  RequirementMode,
  Verdict,
  VerificationPolicy,
  VerificationPolicyRule,
} from "../domain/types";

export class PolicyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyConfigError";
  }
}

const defaultPolicy: VerificationPolicy = {
  version: 1,
  rules: [],
  heuristics: {
    branchIndicators: ["copilot", "claude", "cursor", "codex", "ai", "agent"],
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
    deletedTests: 18,
    skippedTests: 20,
    excessiveMocks: 14,
    largePr: 16,
    generatedText: 14,
  },
};

function parseVerdict(value: unknown, fieldPath: string): Verdict {
  if (typeof value !== "string") {
    throw new PolicyConfigError(
      `Invalid policy config: ${fieldPath} must be pass, needs_review, or fail.`,
    );
  }
  const normalized = value.toLowerCase();
  if (normalized === "pass") {
    return Verdict.PASS;
  }
  if (normalized === "needs_review") {
    return Verdict.NEEDS_REVIEW;
  }
  if (normalized === "fail") {
    return Verdict.FAIL;
  }
  throw new PolicyConfigError(
    `Invalid policy config: ${fieldPath} must be pass, needs_review, or fail.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, fieldPath: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new PolicyConfigError(
      `Invalid policy config: ${fieldPath} must be a non-empty string array.`,
    );
  }
  return value;
}

function parseRequirementMode(
  value: unknown,
  fieldPath: string,
): RequirementMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "all" || value === "any") {
    return value;
  }
  throw new PolicyConfigError(
    `Invalid policy config: ${fieldPath} must be all or any.`,
  );
}

function validateRule(rule: unknown, index: number): VerificationPolicyRule {
  if (!isRecord(rule)) {
    throw new PolicyConfigError(
      `Invalid policy config: rules[${index}] must be an object.`,
    );
  }

  const id = rule.id;
  const when = rule.when;
  const require = rule.require;
  const verdict = rule.verdict;
  const message = rule.message;

  if (typeof id !== "string" || id.length === 0) {
    throw new PolicyConfigError(
      `Invalid policy config: rules[${index}].id must be a non-empty string.`,
    );
  }
  if (!isRecord(when)) {
    throw new PolicyConfigError(
      `Invalid policy config: rules[${index}].when must be an object.`,
    );
  }

  const paths = asStringArray(when.paths, `rules[${index}].when.paths`);
  const parsedVerdict = parseVerdict(verdict, `rules[${index}].verdict`);
  if (typeof message !== "string" || message.length === 0) {
    throw new PolicyConfigError(
      `Invalid policy config: rules[${index}].message must be a non-empty string.`,
    );
  }

  if (require !== undefined && !isRecord(require)) {
    throw new PolicyConfigError(
      `Invalid policy config: rules[${index}].require must be an object.`,
    );
  }

  const changedPaths =
    require?.changedPaths === undefined
      ? undefined
      : asStringArray(
          require.changedPaths,
          `rules[${index}].require.changedPaths`,
        );
  const tests =
    require?.tests === undefined
      ? undefined
      : asStringArray(require.tests, `rules[${index}].require.tests`);
  const mode = parseRequirementMode(
    require?.mode,
    `rules[${index}].require.mode`,
  );
  const review = require?.review;

  if (review !== undefined && review !== "human") {
    throw new PolicyConfigError(
      `Invalid policy config: rules[${index}].require.review must be human.`,
    );
  }

  if (!changedPaths && !tests && !review) {
    throw new PolicyConfigError(
      `Invalid policy config: rules[${index}] must require tests, changed paths, or review.`,
    );
  }

  return {
    id,
    when: { paths },
    require: {
      ...(mode ? { mode } : {}),
      ...(changedPaths ? { changedPaths } : {}),
      ...(tests ? { tests } : {}),
      ...(review ? { review } : {}),
    },
    verdict: parsedVerdict,
    message,
  };
}

@Injectable()
export class PolicyLoader {
  load(policyText?: string): VerificationPolicy {
    if (policyText === undefined || policyText.trim().length === 0) {
      return defaultPolicy;
    }

    const parsed = parse(policyText);
    if (!isRecord(parsed)) {
      throw new PolicyConfigError(
        "Invalid policy config: top-level YAML must be an object.",
      );
    }

    const version = parsed.version;
    if (version !== 1) {
      throw new PolicyConfigError("Invalid policy config: version must be 1.");
    }

    const rulesValue = parsed.rules;
    if (!Array.isArray(rulesValue)) {
      throw new PolicyConfigError(
        "Invalid policy config: rules must be an array.",
      );
    }

    return {
      version: 1,
      rules: rulesValue.map((rule, index) => validateRule(rule, index)),
      heuristics: {
        branchIndicators: defaultPolicy.heuristics.branchIndicators,
      },
      riskWeights: {
        ...defaultPolicy.riskWeights,
      },
    };
  }
}
