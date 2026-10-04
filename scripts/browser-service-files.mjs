import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const paths = ['api/browser-run.js', 'api/mcp.js', 'lib/browser-safety.js',
  'lib/public-web-proxy.js', 'browser.html', 'package.json', 'package-lock.json'];
export async function deploymentFiles() {
  const files = [];
  for (const file of paths) files.push({ file, data: await readFile(new URL(file, root), 'utf8') });
  files.push({ file: 'vercel.json', data: await readFile(new URL('services/browser-cloud/vercel.json', root), 'utf8') });
  return files;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(await deploymentFiles()));
}
