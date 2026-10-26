import { execFile } from 'node:child_process';

export type GitEnv = Record<string, string | undefined>;

export interface HeadContent {
  /** The project is inside a git work tree. */
  repo: boolean;
  /** The file at HEAD; null when it is not there (new file, no commits, not a repo). */
  content: string | null;
}

const MAX_BUFFER = 8_000_000;
const TIMEOUT_MS = 5000;

/**
 * Read-only git for the Code panel (M7): `git show HEAD:<path>` to diff a file against the last
 * commit. Never writes to the repository. Git missing or failing simply means "no diff".
 */
export class GitService {
  private readonly repos = new Map<string, boolean>();

  constructor(
    /** Path of the git executable, or null when it is not installed. */
    private readonly git: () => Promise<string | null>,
    private readonly env: () => Promise<GitEnv>,
  ) {}

  private async run(cwd: string, args: string[]): Promise<string> {
    const git = await this.git();
    if (!git) throw new Error('git non trovato');
    const env = await this.env();
    return new Promise((resolve, reject) => {
      execFile(
        git,
        args,
        { cwd, env, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
  }

  async isRepo(root: string): Promise<boolean> {
    const known = this.repos.get(root);
    if (known !== undefined) return known;
    const repo = await this.run(root, ['rev-parse', '--is-inside-work-tree']).then(
      (out) => out.trim() === 'true',
      () => false,
    );
    this.repos.set(root, repo);
    return repo;
  }

  /** `rel` is relative to `root` (the project), which may be a subfolder of the repository. */
  async headContent(root: string, rel: string): Promise<HeadContent> {
    if (!(await this.isRepo(root))) return { repo: false, content: null };
    const content = await this.run(root, ['show', `HEAD:./${rel}`]).catch(() => null);
    return { repo: true, content };
  }

  /** A repository may be created or committed to while the app runs. */
  forget(): void {
    this.repos.clear();
  }
}
