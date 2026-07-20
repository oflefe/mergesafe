import { ChangedFile } from "../domain/types";
import {
  ClassifiedChangedFile,
  classifyChangedFiles,
} from "./file-classification";

export interface PullRequestScopeMetrics {
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  documentationFiles: number;
  configurationFiles: number;
  otherFiles: number;
  additions: number;
  deletions: number;
  totalLineDelta: number;
  sourceAdditions: number;
  sourceDeletions: number;
  sourceLineDelta: number;
}

function uniqueClassifiedFiles(
  files: ClassifiedChangedFile[],
): ClassifiedChangedFile[] {
  const unique = new Map<string, ClassifiedChangedFile>();
  for (const file of files) {
    const existing = unique.get(file.path);
    if (
      !existing ||
      file.lineDelta > existing.lineDelta ||
      (file.lineDelta === existing.lineDelta &&
        file.additions > existing.additions)
    ) {
      unique.set(file.path, file);
    }
  }
  return [...unique.values()];
}

export function analyzePullRequestScope(
  files: ChangedFile[],
): PullRequestScopeMetrics {
  const classifiedFiles = uniqueClassifiedFiles(classifyChangedFiles(files));
  const sourceFiles = classifiedFiles.filter((file) => file.kind === "source");
  const count = (kind: ClassifiedChangedFile["kind"]): number =>
    classifiedFiles.filter((file) => file.kind === kind).length;
  const sum = (
    selectedFiles: ClassifiedChangedFile[],
    field: "additions" | "deletions" | "lineDelta",
  ): number => selectedFiles.reduce((total, file) => total + file[field], 0);

  return {
    totalFiles: classifiedFiles.length,
    sourceFiles: sourceFiles.length,
    testFiles: count("test"),
    documentationFiles: count("documentation"),
    configurationFiles: count("configuration"),
    otherFiles: count("other"),
    additions: sum(classifiedFiles, "additions"),
    deletions: sum(classifiedFiles, "deletions"),
    totalLineDelta: sum(classifiedFiles, "lineDelta"),
    sourceAdditions: sum(sourceFiles, "additions"),
    sourceDeletions: sum(sourceFiles, "deletions"),
    sourceLineDelta: sum(sourceFiles, "lineDelta"),
  };
}
