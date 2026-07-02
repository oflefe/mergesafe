import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function loadRepositories() {
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
  try {
    const response = await fetch(`${apiBaseUrl}/repos`, { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as Array<{ id: string; owner: string; name: string }>;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const repositories = await loadRepositories();

  return (
    <section>
      <h1>Agentic PR Verification Gate</h1>
      <p>Track pull request verification evidence, risk, and merge readiness.</p>
      <ul>
        {repositories.length === 0 ? (
          <li>No repositories have reported pull request activity yet.</li>
        ) : (
          repositories.map((repository) => (
            <li key={repository.id}>
              <Link href={`/repos/${encodeURIComponent(repository.id)}`}>{repository.owner}/{repository.name}</Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
