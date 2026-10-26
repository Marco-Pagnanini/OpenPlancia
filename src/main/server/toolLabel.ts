import { isAbsolute, relative } from 'node:path';

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Tools that change files; their path feeds the Code panel (M7). */
export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function oneLine(text: string, max = 90): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Path shown to the user: relative to the workspace when inside it. */
export function displayPath(path: string, root: string | null): string {
  if (!root || !isAbsolute(path)) return path;
  const rel = relative(root, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

export function toolFilePath(input: Record<string, unknown> | undefined): string | undefined {
  return str(input?.['file_path']) ?? str(input?.['notebook_path']);
}

/** Short human label such as "Bash: npm test" or "Edit: src/auth.ts". */
export function toolLabel(
  name: string,
  input: Record<string, unknown> | undefined,
  root: string | null,
): string {
  if (FILE_TOOLS.has(name)) {
    const path = toolFilePath(input);
    return path ? `${name}: ${displayPath(path, root)}` : name;
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `${mcp[1]} › ${mcp[2]}`;
  const arg =
    name === 'Bash'
      ? str(input?.['command'])
      : name === 'Grep' || name === 'Glob'
        ? str(input?.['pattern'])
        : name === 'WebFetch'
          ? str(input?.['url'])
          : name === 'WebSearch'
            ? str(input?.['query'])
            : name === 'Task' || name === 'Agent'
              ? str(input?.['description'])
              : undefined;
  return arg ? `${name}: ${oneLine(arg)}` : name;
}
