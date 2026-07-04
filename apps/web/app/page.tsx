import Link from "next/link";
import { fetchApiJson } from "../lib/api-client";

export const dynamic = "force-dynamic";

async function loadRepositories() {
  try {
    const repositories =
      await fetchApiJson<Array<{ id: string; owner: string; name: string }>>(
        "/repos",
      );

    if (!repositories) {
      return [];
    }

    return repositories;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const repositories = await loadRepositories();

  return (
    <section>
      <h1>Agentic PR Verification Gate</h1>
      <p>
        Track pull request verification evidence, risk, and merge readiness.
      </p>
      <ul>
        {repositories.length === 0 ? (
          <li>No repositories have reported pull request activity yet.</li>
        ) : (
          repositories.map((repository) => (
            <li key={repository.id}>
              <Link href={`/repos/${encodeURIComponent(repository.id)}`}>
                {repository.owner}/{repository.name}
              </Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
