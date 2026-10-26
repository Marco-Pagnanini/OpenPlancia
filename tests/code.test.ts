import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodeFeedEntry } from '@shared/ipc';
import { CODE_LIMITS, CodeService } from '../src/main/code/CodeService';
import { GitService } from '../src/main/git/GitService';

let dir: string;
let root: string;

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'plancia-code-')));
  root = join(dir, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, '.plancia'), { recursive: true });
  await writeFile(join(root, 'src/a.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'src/b.ts'), 'export const b = 1;\n');
  await writeFile(join(dir, 'fuori.ts'), 'segreto');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function setup(
  gitService = new GitService(
    async () => 'git',
    async () => process.env,
  ),
) {
  const feeds: CodeFeedEntry[][] = [];
  const changed: string[] = [];
  const watched: string[][] = [];
  let clock = Date.parse('2026-10-26T15:00:00.000Z');
  const code = new CodeService({
    root: () => root,
    git: gitService,
    onFeed: (feed) => feeds.push(feed),
    onFileChanged: (path) => changed.push(path),
    watch: (paths) => watched.push(paths),
    now: () => new Date((clock += 60_000)),
  });
  return { code, feeds, changed, watched };
}

describe('CodeService feed', () => {
  it('lists the files Claude changed, latest first, counting the changes', async () => {
    const t = setup();
    await t.code.touched('t1', 'Edit', join(root, 'src/a.ts'));
    await t.code.touched('t2', 'Write', 'src/b.ts', root);
    await t.code.touched('t1', 'Edit', join(root, 'src/a.ts'));
    expect(t.code.list().map((e) => [e.path, e.terminalId, e.tool, e.edits])).toEqual([
      ['src/a.ts', 't1', 'Edit', 2],
      ['src/b.ts', 't2', 'Write', 1],
    ]);
    expect(t.feeds).toHaveLength(3);
    expect(t.code.list()[0]!.at).toBe('2026-10-26T15:03:00.000Z');
  });

  it('ignores files outside the project and in .plancia/', async () => {
    const t = setup();
    await t.code.touched('t1', 'Write', join(dir, 'fuori.ts'));
    await t.code.touched('t1', 'Write', join(root, '.plancia/board.json'));
    await t.code.touched('t1', 'Write', join(root, '..', 'fuori.ts'));
    expect(t.code.list()).toEqual([]);
  });

  it('keeps at most the feed limit', async () => {
    const t = setup();
    for (let i = 0; i < CODE_LIMITS.feed + 5; i++) {
      await t.code.touched('t1', 'Write', join(root, `src/f${i}.ts`));
    }
    expect(t.code.list()).toHaveLength(CODE_LIMITS.feed);
    expect(t.code.list()[0]!.path).toBe(`src/f${CODE_LIMITS.feed + 4}.ts`);
  });
});

describe('reading files, with git HEAD', () => {
  it('without git: content only', async () => {
    const t = setup();
    expect(await t.code.read('src/a.ts')).toMatchObject({
      path: 'src/a.ts',
      exists: true,
      content: 'export const a = 1;\n',
      head: null,
      repo: false,
    });
  });

  it('in a repository: the committed version, new files and deleted files', async () => {
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    await writeFile(join(root, 'src/a.ts'), 'export const a = 2;\n');
    await writeFile(join(root, 'src/c.ts'), 'nuovo\n');
    await rm(join(root, 'src/b.ts'));
    const t = setup();
    expect(await t.code.read('src/a.ts')).toMatchObject({
      repo: true,
      content: 'export const a = 2;\n',
      head: 'export const a = 1;\n',
    });
    expect(await t.code.read('src/c.ts')).toMatchObject({ repo: true, head: null, exists: true });
    expect(await t.code.read('src/b.ts')).toMatchObject({
      exists: false,
      head: 'export const b = 1;\n',
    });
  });

  it('works when the project is a subfolder of the repository', async () => {
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const gitService = new GitService(
      async () => 'git',
      async () => process.env,
    );
    expect(await gitService.headContent(join(root, 'src'), 'a.ts')).toEqual({
      repo: true,
      content: 'export const a = 1;\n',
    });
  });

  it('refuses paths outside the project, even through a symlink', async () => {
    await symlink(join(dir, 'fuori.ts'), join(root, 'src/link.ts'));
    const t = setup();
    await expect(t.code.read('../fuori.ts')).rejects.toThrow('fuori dalla cartella');
    await expect(t.code.read('src/link.ts')).rejects.toThrow('fuori dalla cartella');
  });

  it('does not show binary or very large files', async () => {
    await writeFile(join(root, 'img.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    await writeFile(join(root, 'big.txt'), 'x'.repeat(CODE_LIMITS.bytes + 1));
    const t = setup();
    expect(await t.code.read('img.png')).toMatchObject({ binary: true, content: '' });
    expect(await t.code.read('big.txt')).toMatchObject({ tooLarge: true, content: '' });
  });

  it('treats a missing git as "no repository"', async () => {
    const t = setup(
      new GitService(
        async () => null,
        async () => process.env,
      ),
    );
    expect(await t.code.read('src/a.ts')).toMatchObject({ repo: false, head: null });
  });
});

describe('watching the files on screen', () => {
  it('watches what the panels show and reports changes by project path', async () => {
    const t = setup();
    await t.code.watch('code-1', 'src/a.ts');
    await t.code.watch('code-2', 'src/a.ts');
    await t.code.watch('code-3', 'src/b.ts');
    expect(t.watched.at(-1)).toEqual([join(root, 'src/a.ts'), join(root, 'src/b.ts')]);
    t.code.fileChanged(join(root, 'src/b.ts'));
    t.code.fileChanged(join(root, 'src/other.ts'));
    expect(t.changed).toEqual(['src/b.ts']);
    await t.code.watch('code-3', null);
    expect(t.watched.at(-1)).toEqual([join(root, 'src/a.ts')]);
    t.code.reset();
    expect(t.watched.at(-1)).toEqual([]);
    expect(t.code.list()).toEqual([]);
  });
});
