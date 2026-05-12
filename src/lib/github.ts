// Minimal GitHub REST client.
//
// Auth: a Personal Access Token in env.GITHUB_TOKEN with the `repo` scope.
// Both classic PATs and fine-grained tokens (with repository-administration
// write + contents write) work. The "Authorization: token <pat>" header
// form is used across all helpers since it is accepted by both PAT styles.
//
// v3 (run #10) additions:
//   - listUserRepos       — GET /user/repos (owner affiliation, sorted by updated)
//   - getRepoFile         — GET /repos/:full/contents/:path (base64 decoded)
//   - putRepoFile         — PUT /repos/:full/contents/:path (create or update)
//   - scaffoldCeoDirectory — commits the five .ceo/* starter files
// All follow the same Ok/Err-result style as the existing createRepo.

import {
  CEO_BOARD,
  CEO_CONTEXT,
  CEO_DECISIONS,
  CEO_GOAL,
  CEO_README,
} from "./ceoScaffold";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "the-ceo-worker";

function ghHeaders(token: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
    ...extra,
  };
}

// ── createRepo (existing, unchanged in behavior) ────────────────────

export interface CreateRepoOpts {
  token: string;
  name: string;
  description?: string;
  isPrivate: boolean;
}

export type CreateRepoResult =
  | { ok: true; name: string; htmlUrl: string; cloneUrl: string; defaultBranch: string }
  | { ok: false; status: number; message: string };

/**
 * Create a repository under the authenticated user's account. auto_init=true
 * ensures a default branch and initial commit exist immediately.
 */
export async function createRepo(opts: CreateRepoOpts): Promise<CreateRepoResult> {
  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: ghHeaders(opts.token, { "Content-Type": "application/json" }),
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

  const body = (await resp.json()) as {
    full_name?: string;
    name?: string;
    html_url?: string;
    clone_url?: string;
    default_branch?: string;
  };
  return {
    ok: true,
    name: body.full_name ?? body.name ?? opts.name,
    htmlUrl: body.html_url ?? "",
    cloneUrl: body.clone_url ?? "",
    defaultBranch: body.default_branch ?? "main",
  };
}

// ── listUserRepos ───────────────────────────────────────────────────

export interface GithubRepoSummary {
  name: string;
  fullName: string;
  description: string | null;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  updatedAt: string;
}

export type ListReposResult =
  | { ok: true; repos: GithubRepoSummary[] }
  | { ok: false; status: number; message: string };

/**
 * List repos for the authenticated user. Filters out forks and archived
 * repos — they're noise in the picker. The owner can show them later if
 * we add a toggle.
 */
export async function listUserRepos(token: string): Promise<ListReposResult> {
  let resp: Response;
  try {
    resp = await fetch(
      `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner`,
      { headers: ghHeaders(token) },
    );
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

  const raw = (await resp.json()) as Array<{
    name: string;
    full_name: string;
    description: string | null;
    clone_url: string;
    html_url: string;
    default_branch: string;
    private: boolean;
    archived: boolean;
    fork: boolean;
    updated_at: string;
  }>;

  const repos: GithubRepoSummary[] = raw
    .filter((r) => !r.fork && !r.archived)
    .map((r) => ({
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      cloneUrl: r.clone_url,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch,
      isPrivate: r.private,
      isArchived: r.archived,
      isFork: r.fork,
      updatedAt: r.updated_at,
    }));

  return { ok: true, repos };
}

// ── getRepoFile ─────────────────────────────────────────────────────

export interface RepoFile {
  content: string;
  sha: string;
}

/**
 * Read a file from a repo via the Contents API. Returns null if 404.
 * Other errors throw with context — caller decides how to surface.
 *
 * `branch` is optional: when omitted, GitHub uses the repo's default
 * branch. This matters for the manager's read path, which doesn't store
 * the default branch on the project row.
 */
export async function getRepoFile(
  token: string,
  fullName: string,
  path: string,
  branch?: string,
): Promise<RepoFile | null> {
  const url = new URL(
    `${GITHUB_API}/repos/${fullName}/contents/${path}`,
  );
  if (branch) url.searchParams.set("ref", branch);

  const resp = await fetch(url.toString(), { headers: ghHeaders(token) });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `getRepoFile(${fullName}, ${path}) failed: ${resp.status} ${text.slice(0, 200)}`,
    );
  }

  const body = (await resp.json()) as {
    content?: string;
    encoding?: string;
    sha?: string;
  };
  if (typeof body.content !== "string" || body.encoding !== "base64") {
    throw new Error(
      `getRepoFile(${fullName}, ${path}): unexpected response shape`,
    );
  }
  return {
    content: decodeBase64Utf8(body.content),
    sha: body.sha ?? "",
  };
}

// ── putRepoFile ─────────────────────────────────────────────────────

export interface PutFileResult {
  sha: string;
  commitSha: string;
}

/**
 * Create or update a file via the Contents API. For creates, omit `sha`.
 * For updates, pass the existing file's `sha`. Returns the new file sha
 * (and the commit sha if available).
 *
 * GitHub will reject creates that target a path already in the tree (422
 * "sha wasn't supplied"). Callers that don't know in advance whether the
 * file exists should first call getRepoFile to fetch a sha if any.
 */
export async function putRepoFile(
  token: string,
  fullName: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string,
): Promise<PutFileResult> {
  const url = `${GITHUB_API}/repos/${fullName}/contents/${path}`;
  const body: Record<string, unknown> = {
    message,
    content: encodeBase64Utf8(content),
    branch,
  };
  if (sha) body.sha = sha;

  const resp = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `putRepoFile(${fullName}, ${path}) failed: ${resp.status} ${text.slice(0, 200)}`,
    );
  }
  const j = (await resp.json()) as {
    content?: { sha?: string };
    commit?: { sha?: string };
  };
  return {
    sha: j.content?.sha ?? "",
    commitSha: j.commit?.sha ?? "",
  };
}

// ── scaffoldCeoDirectory ────────────────────────────────────────────

/**
 * Discriminated result for the .ceo/ scaffold pass:
 *   - ok + scaffolded: we wrote all five files (fresh claim)
 *   - ok + alreadyHadCeoDirectory: the repo already had .ceo/, we left it
 *   - partial: some files were written before a failure; the caller logs
 *     it as a warning (the D1 row should still be created; retry path is
 *     to re-call this function, which will skip-and-update as needed)
 */
export type ScaffoldResult =
  | { ok: true; scaffolded: true; commits: string[] }
  | { ok: true; alreadyHadCeoDirectory: true }
  | { ok: false; partial: boolean; writtenPaths: string[]; message: string };

const COMMIT_MESSAGE = "Add .ceo/ directory — manager's working memory";

/**
 * Scaffold the five `.ceo/` starter files in the given repo. Idempotent
 * at the directory level: if `.ceo/README.md` already exists, we treat
 * the directory as pre-existing and don't touch anything.
 *
 * Five sequential putRepoFile calls per spec — five commits, accepted as
 * acceptable v0 noise. Future hardening can batch via the Git Data API.
 */
export async function scaffoldCeoDirectory(
  token: string,
  fullName: string,
  defaultBranch: string,
): Promise<ScaffoldResult> {
  // Already-has-.ceo guard: if README exists, leave the directory alone.
  let existing: RepoFile | null;
  try {
    existing = await getRepoFile(token, fullName, ".ceo/README.md", defaultBranch);
  } catch (err) {
    return {
      ok: false,
      partial: false,
      writtenPaths: [],
      message: `Pre-check failed: ${(err as Error).message}`,
    };
  }
  if (existing) {
    return { ok: true, alreadyHadCeoDirectory: true };
  }

  // Write all five files. Order: README first (so partial scaffolds still
  // look intentional from the user's perspective), then the four content
  // files in load-order (goal, context, decisions, board).
  const files: Array<[string, string]> = [
    [".ceo/README.md", CEO_README],
    [".ceo/goal.md", CEO_GOAL],
    [".ceo/context.md", CEO_CONTEXT],
    [".ceo/decisions.md", CEO_DECISIONS],
    [".ceo/board.md", CEO_BOARD],
  ];

  const commits: string[] = [];
  const written: string[] = [];

  for (const [path, content] of files) {
    try {
      const r = await putRepoFile(
        token,
        fullName,
        path,
        content,
        COMMIT_MESSAGE,
        defaultBranch,
      );
      written.push(path);
      if (r.commitSha) commits.push(r.commitSha);
    } catch (err) {
      return {
        ok: false,
        partial: written.length > 0,
        writtenPaths: written,
        message:
          `Scaffold failed at ${path}: ${(err as Error).message}. ` +
          `Wrote ${written.length}/${files.length} files. Re-claim to retry.`,
      };
    }
  }

  return { ok: true, scaffolded: true, commits };
}

// ── Base64 (UTF-8 safe) ─────────────────────────────────────────────

function encodeBase64Utf8(s: string): string {
  // btoa is ASCII-only — encode UTF-8 to a byte string first.
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64Utf8(b64: string): string {
  // GitHub returns base64 with embedded newlines; atob accepts them.
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── Error explainer ─────────────────────────────────────────────────

function explainGithubError(status: number, body: string): string {
  if (status === 401) return "GitHub auth failed — check GITHUB_TOKEN.";
  if (status === 403) {
    return `GitHub refused the request (${status}). May be rate-limited.`;
  }
  if (status === 422) {
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
