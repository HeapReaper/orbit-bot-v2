import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LANGUAGE = 'en';

const localesPath = path.join(import.meta.dirname, '..', 'locales');

let translations: Record<string, Record<string, string>> | null = null;

function loadTranslations(): Record<string, Record<string, string>> {
  if (translations) return translations; // already loaded

  const result: Record<string, Record<string, string>> = {};

  try {
    const supportedLanguages = fs
      .readdirSync(localesPath)
      .filter((folder) => fs.statSync(path.join(localesPath, folder)).isDirectory());

    for (const lang of supportedLanguages) {
      const filePath = path.join(localesPath, lang, 'translation.json');

      // Locale folders are keyed lowercase so lookups can be case-insensitive:
      // guild settings store the language as "EN"/"NL" while the folders are "en"/"nl".
      const key = lang.toLowerCase();

      if (!fs.existsSync(filePath)) {
        result[key] = {};
        continue;
      }

      try {
        result[key] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        console.error(`[i18n] Could not parse ${filePath}: ${error}`);
        result[key] = {};
      }
    }
  } catch (error) {
    console.error(`[i18n] Could not read locales from ${localesPath}: ${error}`);
  }

  translations = result;
  return translations;
}

/** Drops the region part so "en-GB" still resolves to the "en" bundle. */
function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return DEFAULT_LANGUAGE;
  return lang.toLowerCase().split(/[-_]/)[0] ?? DEFAULT_LANGUAGE;
}

export function t(
  lang: string | null | undefined,
  key: string,
  variables?: Record<string, string>
): string {
  const bundles = loadTranslations();
  const language = normalizeLanguage(lang);

  let text = bundles[language]?.[key] ?? bundles[DEFAULT_LANGUAGE]?.[key] ?? key;

  if (variables) {
    for (const [name, value] of Object.entries(variables)) {
      // split/join instead of a RegExp: placeholder names and values are user
      // supplied, so neither may be interpreted as a pattern or as `$1`-style
      // replacement syntax.
      text = text.split(`{${name}}`).join(value ?? '');
    }
  }

  return text;
}
