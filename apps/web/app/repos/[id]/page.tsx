import Link from "next/link";
import { fetchApiJson } from "../../../lib/api-client";

export const dynamic = "force-dynamic";

async function loadPullRequests(id: string) {
  try {
    const pullRequests = await fetchApiJson<
      Array<{
        id: string;
        number: number;
        title: string;
        verdict: string;
        riskScore: number;
      }>
    >(`/repos/${id}/prs`);

    if (!pullRequests) {
      return [];
    }

    return pullRequests;
  } catch {
    return [];
  }
}

export default async function RepositoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pullRequests = await loadPullRequests(id);

  return (
    <section>
      <Link href="/">← Back</Link>
      <h1>{decodeURIComponent(id)}</h1>
      <ul>
        {pullRequests.length === 0 ? (
          <li>No PRs have been verified yet.</li>
        ) : (
          pullRequests.map((pullRequest) => (
            <li key={pullRequest.id}>
              <Link href={`/prs/${encodeURIComponent(pullRequest.id)}`}>
                #{pullRequest.number} {pullRequest.title}
              </Link>{" "}
              — {pullRequest.verdict} ({pullRequest.riskScore}/100)
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
