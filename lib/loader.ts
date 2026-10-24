import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.join(import.meta.dirname, '..');

/** Every .ts file below `<root>/<folder>`, at any depth, in a stable order. */
function listFiles(folder: string): string[] {
  const dir = path.join(rootDir, folder);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .sort()
    .map((file) => path.join(dir, file));
}

/**
 * Imports the default export of every file in `folder` and keeps the ones that
 * pass `isValid`. Files that fail validation are reported, not silently skipped.
 */
export async function loadDefaults<T>(
  folder: string,
  isValid: (value: any) => value is T,
  describe: string
): Promise<{ file: string; value: T }[]> {
  const loaded: { file: string; value: T }[] = [];

  for (const file of listFiles(folder)) {
    const module = await import(pathToFileURL(file).href);
    const value = module.default;

    if (!isValid(value)) {
      console.warn(`[WARNING] ${path.relative(rootDir, file)} is not a valid ${describe}.`);
      continue;
    }

    loaded.push({ file: path.relative(rootDir, file), value });
  }

  return loaded;
}
