import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { BOARD_SCHEMA_VERSION, persistedBoardSchema } from '@shared/schemas';
import type { PersistedBoard } from '@shared/types';
import { emptyPersistedBoard } from '../board/BoardStore';
import { writeFileAtomic } from '../util/atomicWrite';

export const PLANCIA_DIR = '.plancia';
export const BOARD_FILE = 'board.json';

export class BoardFileError extends Error {}

export function boardFilePath(root: string): string {
  return join(root, PLANCIA_DIR, BOARD_FILE);
}

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/** Loads `.plancia/board.json`; a missing file means an empty board. */
export async function readBoardFile(root: string): Promise<PersistedBoard> {
  let text: string;
  try {
    text = await readFile(boardFilePath(root), 'utf8');
  } catch (err) {
    if (isMissing(err)) return emptyPersistedBoard();
    throw err;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new BoardFileError(`${PLANCIA_DIR}/${BOARD_FILE} non è JSON valido: ${detail}`);
  }

  const version =
    typeof raw === 'object' && raw !== null && 'schemaVersion' in raw
      ? raw.schemaVersion
      : undefined;
  if (typeof version === 'number' && version > BOARD_SCHEMA_VERSION) {
    throw new BoardFileError(
      `${PLANCIA_DIR}/${BOARD_FILE} usa la versione di schema ${version}, più recente di quella supportata (${BOARD_SCHEMA_VERSION}). Aggiorna OpenPlancia.`,
    );
  }

  const parsed = persistedBoardSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BoardFileError(
      `${PLANCIA_DIR}/${BOARD_FILE} non è valido:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export async function writeBoardFile(root: string, board: PersistedBoard): Promise<void> {
  await writeFileAtomic(boardFilePath(root), `${JSON.stringify(board, null, 2)}\n`);
}
