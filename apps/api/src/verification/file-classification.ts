import { ChangedFile } from "../domain/types";

export type ChangedFileKind =
  | "source"
  | "test"
  | "documentation"
  | "configuration"
  | "other";

export interface ClassifiedChangedFile {
  path: string;
  kind: ChangedFileKind;
  additions: number;
  deletions: number;
  lineDelta: number;
}

const sourceExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".sql",
];

const testFilePattern =
  /(^|\/)(tests?|__tests__|specs?)\/|(\.|_)(spec|test)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|swift|kt)$/i;

const documentationPattern =
  /(^|\/)(docs?|readme|changelog)(\/|\.|$)|\.(md|mdx|txt|rst|adoc)$/i;

const configurationPattern =
  /(^|\/)(\.env(?:\.[^/]*)?|dockerfile|docker-compose(?:\.[^/]*)?|compose(?:\.[^/]*)?|\.github\/workflows)(\/|$)|(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements\.txt|poetry\.lock|pipfile\.lock|cargo\.(toml|lock)|go\.(mod|sum)|pyproject\.toml|pom\.xml|build\.gradle|tsconfig(?:\.[^/]*)?\.json|webpack\.config\.[^/]+|vite\.config\.[^/]+|\.prettierrc(?:\.[^/]*)?|\.eslintrc(?:\.[^/]*)?)$/i;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function hasSourceExtension(path: string): boolean {
  const normalized = path.toLowerCase();
  return sourceExtensions.some((extension) => normalized.endsWith(extension));
}

function isTestFile(path: string): boolean {
  return testFilePattern.test(path);
}

function isDocumentationFile(path: string): boolean {
  return documentationPattern.test(path);
}

function isConfigurationFile(path: string): boolean {
  return configurationPattern.test(path);
}

export function classifyChangedFile(file: ChangedFile): ClassifiedChangedFile {
  const path = normalizePath(file.path);
  const kind: ChangedFileKind = isTestFile(path)
    ? "test"
    : isDocumentationFile(path)
      ? "documentation"
      : isConfigurationFile(path)
        ? "configuration"
        : hasSourceExtension(path)
          ? "source"
          : "other";
  const additions = file.additions ?? 0;
  const deletions = file.deletions ?? 0;

  return {
    path,
    kind,
    additions,
    deletions,
    lineDelta: additions + deletions,
  };
}

export function classifyChangedFiles(
  files: ChangedFile[],
): ClassifiedChangedFile[] {
  return files
    .map(classifyChangedFile)
    .sort((left, right) =>
      left.path === right.path
        ? left.kind.localeCompare(right.kind)
        : left.path.localeCompare(right.path),
    );
}
