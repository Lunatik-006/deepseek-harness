/** Static child program for exclusive checkout-directory allocation inside the process sandbox. */

/**
 * The child receives the configured root and destination as literal argv. Existing roots retain
 * their files. New roots get a self-ignoring .gitignore; automatic Session bootstrap
 * also creates a missing ignore file in its configured pool, never overwriting one.
 */
export const PREPARE_DIRECTORY = `
import fs from 'node:fs/promises';
import path from 'node:path';
async function main() {
  const [root, destination, ensureIgnore] = process.argv.slice(1);
  await fs.mkdir(path.dirname(root), { recursive: true });
  let created = false;
  try {
    await fs.mkdir(root);
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await fs.stat(root)).isDirectory()) throw error;
  }
  if (created || ensureIgnore === 'ensure-ignore') {
    try {
      await fs.writeFile(path.join(root, '.gitignore'), '*\\n', { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
`
