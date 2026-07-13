import {
  ChangedFile,
  TestFileMapping,
  TestImpactResult,
  TestMatchReason,
} from "../domain/types";

const testFilePattern =
  /(^|\/)(tests?|__tests__|specs?)\/|(\.|_)(spec|test)\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"];

function isTestFile(path: string): boolean {
  return testFilePattern.test(path);
}

function isSourceFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return sourceExtensions.some((extension) => normalized.endsWith(extension));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function basenameWithoutExtension(path: string): string {
  const normalized = normalizePath(path);
  const name = normalized.split("/").pop() ?? normalized;
  return name.replace(/\.[^.]+$/, "");
}

function normalizeTestStem(path: string): string {
  return basenameWithoutExtension(path)
    .toLowerCase()
    .replace(/^test[._-]/, "")
    .replace(/(?:[._-](?:spec|test))+$/, "")
    .replace(/(?:[._-](?:service|controller|module))+$/, "");
}

function readImports(path: string, content: string): string[] {
  const imports = new Set<string>();
  if (path.endsWith(".py")) {
    const fromRegex = /^\s*from\s+([.\w]+)\s+import\s+/gm;
    const importRegex = /^\s*import\s+([.\w]+)/gm;
    for (const regex of [fromRegex, importRegex]) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content))) {
        imports.add(match[1]);
      }
    }
    return [...imports];
  }

  const regex = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    imports.add(match[1] ?? match[2]);
  }
  return [...imports];
}

function joinPath(baseDir: string, target: string): string {
  const segments = [
    ...baseDir.split("/").filter(Boolean),
    ...target.split("/"),
  ];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

function resolveImport(
  importer: string,
  importPath: string,
  repositoryFiles: Record<string, string>,
): string | undefined {
  if (importPath.startsWith(".")) {
    const base = joinPath(dirname(importer), importPath);
    const candidates = [
      base,
      ...sourceExtensions.map((extension) => `${base}${extension}`),
      ...sourceExtensions.map((extension) => `${base}/index${extension}`),
    ];
    return candidates.find((candidate) => candidate in repositoryFiles);
  }

  if (importer.endsWith(".py")) {
    const pyCandidate = `${importPath.replace(/\./g, "/")}.py`;
    if (pyCandidate in repositoryFiles) {
      return pyCandidate;
    }
    const initCandidate = `${importPath.replace(/\./g, "/")}/__init__.py`;
    if (initCandidate in repositoryFiles) {
      return initCandidate;
    }
  }

  return undefined;
}

function addMatchReason(
  matches: Map<string, Set<TestMatchReason>>,
  testPath: string,
  reason: TestMatchReason,
): void {
  const reasons = matches.get(testPath) ?? new Set<TestMatchReason>();
  reasons.add(reason);
  matches.set(testPath, reasons);
}

function buildTestMapping(
  sourceFile: string,
  repositoryFiles: Record<string, string>,
  reverseGraph: Map<string, Set<string>>,
  testFilesChangedInPullRequest: Set<string>,
): TestFileMapping {
  const matches = new Map<string, Set<TestMatchReason>>();

  const queue = [{ path: sourceFile, distance: 0 }];
  const visitedNonTests = new Set<string>([sourceFile]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = [...(reverseGraph.get(current.path) ?? [])].sort();
    for (const dependent of dependents) {
      const distance = current.distance + 1;
      if (isTestFile(dependent)) {
        addMatchReason(
          matches,
          dependent,
          distance === 1 ? "direct-dependent" : "transitive-dependent",
        );
        continue;
      }
      if (!visitedNonTests.has(dependent)) {
        visitedNonTests.add(dependent);
        queue.push({ path: dependent, distance });
      }
    }
  }

  const sourceDirectory = dirname(sourceFile).toLowerCase();
  const sourceStem = normalizeTestStem(sourceFile);
  const testCandidates = [
    ...new Set([
      ...Object.keys(repositoryFiles),
      ...testFilesChangedInPullRequest,
    ]),
  ]
    .filter((candidate) => isTestFile(candidate))
    .sort();
  for (const candidate of testCandidates) {
    const candidateDirectory = dirname(candidate).toLowerCase();
    const sameStem = normalizeTestStem(candidate) === sourceStem;
    const nearby =
      sourceDirectory.length > 0 &&
      (candidateDirectory === sourceDirectory ||
        candidateDirectory.startsWith(`${sourceDirectory}/`));
    if (sameStem) {
      addMatchReason(matches, candidate, "same-stem");
    }
    if (nearby) {
      addMatchReason(matches, candidate, "nearby");
    }
  }

  for (const testPath of matches.keys()) {
    if (testFilesChangedInPullRequest.has(testPath)) {
      addMatchReason(matches, testPath, "changed-test");
    }
  }

  return {
    sourceFile,
    matchedTests: [...matches.keys()].sort(),
    matchReasons: [
      ...new Set(
        [...matches.values()].flatMap((reasons) => [...reasons]),
      ),
    ].sort(),
  };
}

export function mapImpactedTests(
  changedFiles: ChangedFile[],
  repositoryFiles: Record<string, string> = {},
): TestImpactResult {
  const repoFiles = Object.fromEntries(
    Object.entries(repositoryFiles).map(([path, content]) => [
      normalizePath(path),
      content,
    ]),
  );
  for (const file of changedFiles) {
    const normalizedPath = normalizePath(file.path);
    if (!(normalizedPath in repoFiles) && file.content !== undefined) {
      repoFiles[normalizedPath] = file.content;
    }
  }
  const reverseGraph = new Map<string, Set<string>>();

  for (const [path, content] of Object.entries(repoFiles)) {
    for (const dependency of readImports(path, content)) {
      const resolved = resolveImport(path, dependency, repoFiles);
      if (!resolved) {
        continue;
      }
      const dependents = reverseGraph.get(resolved) ?? new Set<string>();
      dependents.add(path);
      reverseGraph.set(resolved, dependents);
    }
  }

  const changedPaths = [
    ...new Set(changedFiles.map((file) => normalizePath(file.path))),
  ].sort();
  const testFilesChangedInPullRequest = new Set(
    changedPaths.filter((path) => isTestFile(path)),
  );
  const changedSourceFiles = changedPaths.filter(
    (path) => isSourceFile(path) && !isTestFile(path),
  );
  const sourceMappings = changedSourceFiles.map((sourceFile) =>
    buildTestMapping(
      sourceFile,
      repoFiles,
      reverseGraph,
      testFilesChangedInPullRequest,
    ),
  );
  const changedTestMappings: TestFileMapping[] = [
    ...testFilesChangedInPullRequest,
  ]
    .filter((path) => isSourceFile(path))
    .map((sourceFile) => ({
      sourceFile,
      matchedTests: [sourceFile],
      matchReasons: ["changed-test"],
    }));
  const testMappings = [...sourceMappings, ...changedTestMappings].sort(
    (left, right) =>
      left.sourceFile === right.sourceFile
        ? 0
        : left.sourceFile < right.sourceFile
          ? -1
          : 1,
  );
  const impactedTests = [
    ...new Set(testMappings.flatMap((mapping) => mapping.matchedTests)),
  ].sort();
  const missingTestCoverage = sourceMappings
    .filter((mapping) => mapping.matchedTests.length === 0)
    .map((mapping) => mapping.sourceFile);

  return {
    impactedTests,
    missingTestCoverage,
    suggestedCommands: [],
    testMappings,
  };
}
