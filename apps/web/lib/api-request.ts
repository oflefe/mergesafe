function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:3001";
}

function getApiToken(): string | undefined {
  return process.env.DASHBOARD_API_TOKEN ?? process.env.ADMIN_API_TOKEN;
}

export function getRequestHeaders(): HeadersInit | undefined {
  const token = getApiToken();

  if (!token) {
    return undefined;
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchApiJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    cache: "no-store",
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}
