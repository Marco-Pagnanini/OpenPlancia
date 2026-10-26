import { readFile } from 'node:fs/promises';
import { appSettingsSchema } from '@shared/schemas';
import type { AppSettings } from '@shared/types';
import { writeFileAtomic } from '../util/atomicWrite';

/** App-level settings in userData. Missing or corrupt files fall back to defaults. */
export async function loadSettings(file: string): Promise<AppSettings> {
  try {
    const parsed = appSettingsSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function saveSettings(file: string, settings: AppSettings): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}
