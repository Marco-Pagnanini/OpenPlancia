import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export class PathOutsideWorkspaceError extends Error {
  constructor(readonly requested: string) {
    super(`Percorso fuori dalla cartella del progetto: ${requested}`);
  }
}

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

/** realpath of the deepest existing ancestor, with the missing tail re-appended. */
async function realpathAllowMissing(path: string): Promise<string> {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(await realpath(current), ...missing.reverse());
    } catch (err) {
      if (!isMissing(err)) throw err;
      const parent = resolve(current, '..');
      if (parent === current) throw err;
      missing.push(relative(parent, current));
      current = parent;
    }
  }
}

/**
 * Resolves `requested` (relative to the workspace root, or absolute) to a real absolute path
 * and rejects anything that ends up outside the workspace, including through symlinks.
 * The target does not need to exist yet (e.g. a file about to be created).
 */
export async function resolveInWorkspace(root: string, requested: string): Promise<string> {
  const realRoot = await realpath(root);
  const target = await realpathAllowMissing(resolve(realRoot, requested));
  const rel = relative(realRoot, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathOutsideWorkspaceError(requested);
  }
  return target;
}
