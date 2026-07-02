import { ExternalReviewFinding, ReviewComment } from '../domain/types';

export function extractExternalReviewFindings(
  reviewComments: ReviewComment[],
): ExternalReviewFinding[] {
  return reviewComments
    .filter((comment) =>
      /(coderabbit|copilot|claude|cursor|codex)/i.test(comment.author),
    )
    .filter((comment) => !comment.resolved)
    .map((comment) => ({
      source: comment.author,
      author: comment.author,
      body: comment.body.trim(),
    }));
}
