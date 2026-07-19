import { PullRequestType } from "../../domain/types";

export const PR_TYPE_PROTOTYPE_VERSION = "pr-types-v1";

export interface PullRequestTypePrototype {
  type: PullRequestType;
  description: string;
  examples: string[];
  semantic: boolean;
}

export const pullRequestTypePrototypes: PullRequestTypePrototype[] = [
  {
    type: "feature",
    description:
      "Introduces new user-visible or system behavior, a new capability, endpoint, workflow, integration, or domain rule.",
    examples: [
      "Add account recovery flow",
      "Introduce patient eligibility checks",
      "Create a new reporting endpoint",
    ],
    semantic: true,
  },
  {
    type: "bug-fix",
    description:
      "Corrects existing behavior, resolves a defect or regression, handles a broken edge case, or prevents an incorrect result.",
    examples: [
      "Fix duplicate invoice creation",
      "Correct session expiry handling",
      "Prevent null eligibility status",
    ],
    semantic: true,
  },
  {
    type: "refactor",
    description:
      "Changes internal structure, organization, naming, or implementation while intending to preserve externally observable behavior.",
    examples: [
      "Extract billing calculation service",
      "Replace duplicated controller logic",
      "Simplify repository abstractions without behavior changes",
    ],
    semantic: true,
  },
  {
    type: "security",
    description:
      "Changes authentication, authorization, permissions, secrets, tenant boundaries, sensitive data handling, or security controls.",
    examples: [
      "Restrict tenant access to medical records",
      "Change role permission checks",
      "Harden token validation",
    ],
    semantic: true,
  },
  {
    type: "dependency-update",
    description: "Updates dependency manifests, versions, or lockfiles.",
    examples: ["Upgrade NestJS", "Refresh package lockfile"],
    semantic: false,
  },
  {
    type: "database-migration",
    description: "Changes database schema, migrations, or data migration scripts.",
    examples: ["Add eligibility column", "Create rollback migration"],
    semantic: false,
  },
  {
    type: "configuration",
    description: "Changes environment, application, build, or runtime configuration.",
    examples: ["Add environment setting", "Change TypeScript configuration"],
    semantic: false,
  },
  {
    type: "infrastructure",
    description: "Changes deployment, CI/CD, containers, Terraform, Kubernetes, or infrastructure automation.",
    examples: ["Update CI workflow", "Add Terraform resource"],
    semantic: false,
  },
  {
    type: "test-only",
    description: "Changes tests without changing production source code.",
    examples: ["Add unit tests", "Update integration fixtures"],
    semantic: false,
  },
  {
    type: "documentation",
    description: "Changes documentation without changing executable behavior.",
    examples: ["Update README", "Add migration guide"],
    semantic: false,
  },
  {
    type: "generated-code",
    description: "Introduces or updates generated or auto-generated source artifacts.",
    examples: ["Regenerate API client", "Update generated schema types"],
    semantic: false,
  },
];

export function prototypeEmbeddingText(
  prototype: PullRequestTypePrototype,
): string {
  return [
    `Pull request type: ${prototype.type}.`,
    prototype.description,
    `Examples: ${prototype.examples.join("; ")}.`,
  ].join(" ");
}
