import { CheckRunSnapshot } from "../domain/types";

export function summarizeCiEvidence(
  checkRuns: CheckRunSnapshot[],
  ciPassed: boolean,
): string {
  if (checkRuns.length === 0) {
    return "No CI checks were reported on the pull request.";
  }
  const summary = checkRuns
    .map((checkRun) => `${checkRun.name}: ${checkRun.conclusion ?? "pending"}`)
    .join(", ");
  return `${ciPassed ? "CI passed" : "CI requires attention"} - ${summary}`;
}
