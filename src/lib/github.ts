// Minimal GitHub REST client. We only need POST /user/repos for now; if/when
// we add repo reads or other writes, extend here rather than scattering
// fetch() calls across the worker.
//
// Auth: a Personal Access Token in env.GITHUB_TOKEN with the `repo` scope.
// Both classic PATs and fine-grained tokens (with repository-administration
// write) work. The "Authorization: token <pat>" header form is used since it
// is accepted by both PAT styles.

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "the-ceo-worker";

export interface CreateRepoOpts {
  token: string;
  name: string;
  description?: string;
  isPrivate: boolean;
}

export type CreateRepoResult =
  | { ok: true; name: string; htmlUrl: string; cloneUrl: string }
  | { ok: false; status: number; message: string };

/**
 * Create a repository under the authenticated user's account. Initializes
 * the repo (auto_init=true) so it has a default branch + initial commit and
 * is immediately clonable.
 *
 * Returns a discriminated result rather than throwing. Mapped error codes:
 *   - 401 → "GitHub auth failed — check GITHUB_TOKEN."
 *   - 422 → likely a name collision; the message includes GitHub's reason
 *   - 403 → rate limit / abuse detection
 *   - any other → bubbles up the GitHub error message
 */
export async function createRepo(opts: CreateRepoOpts): Promise<CreateRepoResult> {
  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: {
        "Authorization": `token ${opts.token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        name: opts.name,
        description: opts.description ?? "",
        private: opts.isPrivate,
        auto_init: true,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `Network error reaching GitHub: ${(err as Error).message}`,
    };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, message: explainGithubError(resp.status, text) };
  }

  // 201 Created on success.
  const body = (await resp.json()) as {
    full_name?: string;
    name?: string;
    html_url?: string;
    clone_url?: string;
  };
  return {
    ok: true,
    name: body.full_name ?? body.name ?? opts.name,
    htmlUrl: body.html_url ?? "",
    cloneUrl: body.clone_url ?? "",
  };
}

function explainGithubError(status: number, body: string): string {
  if (status === 401) return "GitHub auth failed — check GITHUB_TOKEN.";
  if (status === 403) {
    // GitHub returns 403 for rate limits and abuse-detection.
    return `GitHub refused the request (${status}). May be rate-limited.`;
  }
  if (status === 422) {
    // Validation failure — usually name already exists or invalid characters.
    // Try to surface GitHub's own message if we can parse it.
    try {
      const j = JSON.parse(body) as { errors?: Array<{ message?: string }>; message?: string };
      const detail =
        j.errors?.[0]?.message?.toLowerCase().includes("already exists")
          ? "name already exists"
          : (j.errors?.[0]?.message ?? j.message ?? body.slice(0, 200));
      return `GitHub validation failed: ${detail}`;
    } catch {
      return `GitHub validation failed: ${body.slice(0, 200)}`;
    }
  }
  if (status >= 500) return `GitHub upstream error (${status}). Try again.`;
  return `GitHub error ${status}: ${body.slice(0, 200)}`;
}
