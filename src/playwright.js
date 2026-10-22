import { packScan, scanBundle, InputError } from './core.js';
import { writeFile } from 'node:fs/promises';

/** Scan the current page state; caller owns navigation and interaction. */
export async function scanPage(page, { scope, profile = 'default', tags = [], include = [], exclude = [], disableRules = [] } = {}) {
  for (const [name, value] of Object.entries({ tags, include, exclude, disableRules })) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new InputError(`${name} must be an array of nonempty strings.`);
  }
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  let builder = new AxeBuilder({ page });
  if (tags.length) builder = builder.withTags([...tags].sort());
  if (disableRules.length) builder = builder.disableRules([...disableRules].sort());
  for (const selector of [...include].sort()) builder = builder.include(selector);
  for (const selector of [...exclude].sort()) builder = builder.exclude(selector);
  const results = await builder.analyze();
  return packScan({ scope, profile, context: { include: [...include].sort(), exclude: [...exclude].sort() }, results });
}

/** Use unique paths for parallel workers, then pass all files to the check CLI. */
export async function writeScans(path, scans) {
  await writeFile(path, JSON.stringify(scanBundle(scans), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}
