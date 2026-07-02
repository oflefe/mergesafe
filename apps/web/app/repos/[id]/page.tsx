import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function loadPullRequests(id: string) {
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
  try {
    const response = await fetch(`${apiBaseUrl}/repos/${id}/prs`, { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as Array<{
      id: string;
      number: number;
      title: string;
      verdict: string;
      riskScore: number;
    }>;
  } catch {
    return [];
  }
}

export default async function RepositoryPage({ params }: { params: Promise<{ id: string }> }) {
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
              </Link>{' '}
              — {pullRequest.verdict} ({pullRequest.riskScore}/100)
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
