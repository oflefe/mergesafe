import { ChangedFile, TestImpactResult } from '../domain/types';

const testFilePattern =
  /(^|\/)(tests?|__tests__|specs?)\/|(\.|_)(spec|test)\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];

function isTestFile(path: string): boolean {
  return testFilePattern.test(path);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function basenameWithoutExtension(path: string): string {
  const normalized = normalizePath(path);
  const name = normalized.split('/').pop() ?? normalized;
  return name.replace(/\.[^.]+$/, '');
}

function readImports(path: string, content: string): string[] {
  const imports = new Set<string>();
  if (path.endsWith('.py')) {
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
  const segments = [...baseDir.split('/').filter(Boolean), ...target.split('/')];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join('/');
}

function resolveImport(
  importer: string,
  importPath: string,
  repositoryFiles: Record<string, string>,
): string | undefined {
  if (importPath.startsWith('.')) {
    const base = joinPath(dirname(importer), importPath);
    const candidates = [
      base,
      ...sourceExtensions.map((extension) => `${base}${extension}`),
      ...sourceExtensions.map((extension) => `${base}/index${extension}`),
    ];
    return candidates.find((candidate) => candidate in repositoryFiles);
  }

  if (importer.endsWith('.py')) {
    const pyCandidate = `${importPath.replace(/\./g, '/')}.py`;
    if (pyCandidate in repositoryFiles) {
      return pyCandidate;
    }
    const initCandidate = `${importPath.replace(/\./g, '/')}/__init__.py`;
    if (initCandidate in repositoryFiles) {
      return initCandidate;
    }
  }

  return undefined;
}

export function mapImpactedTests(
  changedFiles: ChangedFile[],
  repositoryFiles: Record<string, string> = {},
): TestImpactResult {
  const repoFiles = Object.fromEntries(
    Object.entries(repositoryFiles).map(([path, content]) => [normalizePath(path), content]),
  );
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

  const changedPaths = changedFiles.map((file) => normalizePath(file.path));
  const impactedTests = new Set<string>();

  for (const changedPath of changedPaths) {
    if (isTestFile(changedPath)) {
      impactedTests.add(changedPath);
      continue;
    }

    const queue = [changedPath];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const dependents = reverseGraph.get(current);
      if (!dependents) {
        continue;
      }
      for (const dependent of dependents) {
        if (isTestFile(dependent)) {
          impactedTests.add(dependent);
        } else {
          queue.push(dependent);
        }
      }
    }

    const stem = basenameWithoutExtension(changedPath).replace(/\.(service|controller|module)$/, '');
    for (const candidate of Object.keys(repoFiles)) {
      if (!isTestFile(candidate)) {
        continue;
      }
      const sameStem = basenameWithoutExtension(candidate).includes(stem);
      const nearby = dirname(candidate).includes(dirname(changedPath));
      if (sameStem || nearby) {
        impactedTests.add(candidate);
      }
    }
  }

  const nonDocCodeChanges = changedPaths.filter(
    (path) => !isTestFile(path) && !/\.(md|mdx|txt)$/i.test(path),
  );
  const missingTestCoverage =
    nonDocCodeChanges.length > 0 && impactedTests.size === 0 ? nonDocCodeChanges : [];

  return {
    impactedTests: [...impactedTests].sort(),
    missingTestCoverage,
    suggestedCommands: [],
  };
}
