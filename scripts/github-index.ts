import { readHeader, record } from '../src/contract.ts';
import { commitSha, environments, rawUrl, sources, surveyPath } from '../src/paths.ts';
import type { Environment } from '../src/paths.ts';

export type Request = typeof fetch;

function sha(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 40 || !commitSha.test(value)) {
    throw new Error('GitHub returned an invalid revision.');
  }
  return value;
}

export async function githubJson(url: string, request: Request, token?: string): Promise<unknown> {
  const response = await request(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for ${url}`);
  return response.json();
}

async function discover(env: Environment, request: Request, token?: string) {
  const base = `https://api.github.com/repos/ishizuki-tech/${sources[env].repo}`;
  const branch = record(await githubJson(`${base}/branches/main`, request, token));
  const commit = record(branch.commit);
  const revision = sha(commit.sha);
  const root = sha(record(record(commit.commit).tree).sha);
  const tree = async (id: string, recursive = false) => {
    const result = record(await githubJson(
      `${base}/git/trees/${id}${recursive ? '?recursive=1' : ''}`, request, token,
    ));
    if (!Array.isArray(result.tree) || typeof result.truncated !== 'boolean') {
      throw new Error('GitHub returned an invalid repository tree.');
    }
    return { nodes: result.tree.map(record), truncated: result.truncated };
  };

  const snapshot = await tree(root, true);
  if (!snapshot.truncated) {
    return { revision, paths: snapshot.nodes.filter(item => item.type === 'blob' && item.mode === '100644')
      .map(item => item.path) };
  }

  // Large legacy archives can truncate recursive responses. Walk only date/survey directories.
  const completeTree = async (id: string) => {
    const result = await tree(id);
    if (result.truncated) throw new Error('GitHub truncated a non-recursive repository tree.');
    return result.nodes;
  };
  const paths: unknown[] = [];
  for (const day of await completeTree(root)) {
    if (day.type !== 'tree' || typeof day.path !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.path)) continue;
    const folder = (await completeTree(sha(day.sha))).find(item => item.type === 'tree' && item.path === 'survey');
    if (!folder) continue;
    for (const file of await completeTree(sha(folder.sha))) {
      if (file.type === 'blob' && file.mode === '100644' && typeof file.path === 'string') {
        paths.push(`${day.path}/survey/${file.path}`);
      }
    }
  }
  return { revision, paths };
}

async function buildSource(env: Environment, request: Request, token?: string) {
  const { revision, paths } = await discover(env, request, token);
  const routes = paths.flatMap(path => {
    const route = typeof path === 'string' ? surveyPath(path) : null;
    return route ? [route] : [];
  }).sort((a, b) => b.path.localeCompare(a.path));

  // Fetch only V2 JSON at the discovered revision. Only the explicit metadata allowlist is emitted.
  const surveys = [];
  for (let i = 0; i < routes.length; i += 6) {
    const batch = await Promise.all(routes.slice(i, i + 6).map(async route => {
      const data = await githubJson(rawUrl(env, revision, route.path), request);
      const { status, exportedAt } = readHeader(data, route);
      return { path: route.path, status, exportedAt };
    }));
    surveys.push(...batch);
  }
  return { revision, surveys };
}

export async function buildIndex(request: Request = fetch, token?: string) {
  const [production, development] = await Promise.all(
    environments.map(env => buildSource(env, request, token)),
  );
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: { production, development },
  };
}
