import { spawn } from 'node-pty';
import type { SpawnFn } from './PtyService';

export const nodePtySpawn: SpawnFn = ({ file, args, cwd, env, cols, rows }) =>
  spawn(file, args, { name: 'xterm-256color', cwd, env, cols, rows, encoding: 'utf8' });
