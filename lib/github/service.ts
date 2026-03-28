const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

function extractGithubUsername(url?: string | null) {
  if (!url) {
    return null;
  }

  const match = url.match(/github\.com\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

export async function fetchGithubEvidence(url?: string | null) {
  const username = extractGithubUsername(url);

  if (!username) {
    return {
      summary: null,
      sources: [] as Array<{ label: string; url: string }>,
    };
  }

  try {
    const requestInit = {
      headers: {
        "User-Agent": "Niural Hiring OS",
      },
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    } satisfies RequestInit;

    const [profileResponse, reposResponse] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, requestInit),
      fetch(
        `https://api.github.com/users/${username}/repos?sort=updated&per_page=3`,
        requestInit,
      ),
    ]);

    if (!profileResponse.ok || !reposResponse.ok) {
      return {
        summary: null,
        sources: [{ label: "GitHub profile", url }],
      };
    }

    const profile = (await profileResponse.json()) as {
      login?: string;
      bio?: string;
      public_repos?: number;
    };
    const repos = (await reposResponse.json()) as Array<{ name?: string; html_url?: string }>;

    const repoNames = repos.map((repo) => repo.name).filter(Boolean).join(", ");

    return {
      summary: `${profile.login ?? username} has ${profile.public_repos ?? "multiple"} public repositories. Recent public work includes ${repoNames || "active GitHub contributions"}. ${profile.bio ?? ""}`.trim(),
      sources: [
        { label: "GitHub profile", url },
        ...repos
          .filter((repo) => repo.html_url)
          .map((repo) => ({
            label: repo.name ?? "Repository",
            url: repo.html_url as string,
          })),
      ],
    };
  } catch {
    return {
      summary: null,
      sources: [{ label: "GitHub profile", url }],
    };
  }
}
