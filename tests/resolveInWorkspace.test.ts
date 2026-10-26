import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PathOutsideWorkspaceError,
  resolveInWorkspace,
} from '../src/main/files/resolveInWorkspace';

let dir: string;
let root: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-ws-')));
  root = join(dir, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), '# regole');
  await writeFile(join(dir, 'secret.txt'), 'x');
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('resolveInWorkspace', () => {
  it('resolves paths inside the workspace', async () => {
    await expect(resolveInWorkspace(root, '.')).resolves.toBe(root);
    await expect(resolveInWorkspace(root, 'AGENTS.md')).resolves.toBe(join(root, 'AGENTS.md'));
    await expect(resolveInWorkspace(root, 'src/../AGENTS.md')).resolves.toBe(
      join(root, 'AGENTS.md'),
    );
    await expect(resolveInWorkspace(root, join(root, 'src'))).resolves.toBe(join(root, 'src'));
  });

  it('allows files that do not exist yet', async () => {
    await expect(resolveInWorkspace(root, 'docs/new/NOTE.md')).resolves.toBe(
      join(root, 'docs/new/NOTE.md'),
    );
  });

  it('rejects traversal and absolute paths outside', async () => {
    await expect(resolveInWorkspace(root, '../secret.txt')).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
    await expect(resolveInWorkspace(root, join(dir, 'secret.txt'))).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
    await expect(resolveInWorkspace(root, '/etc/passwd')).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
  });

  it('rejects a sibling folder that only shares the prefix', async () => {
    await mkdir(join(dir, 'repo-evil'));
    await expect(resolveInWorkspace(root, '../repo-evil')).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
  });

  it('rejects symlinks that escape, even for files not created yet', async () => {
    await symlink(dir, join(root, 'escape'));
    await expect(resolveInWorkspace(root, 'escape/secret.txt')).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
    await expect(resolveInWorkspace(root, 'escape/new.md')).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
  });

  it('follows symlinks that stay inside', async () => {
    await symlink(join(root, 'src'), join(root, 'link'));
    await expect(resolveInWorkspace(root, 'link')).resolves.toBe(join(root, 'src'));
  });
});
