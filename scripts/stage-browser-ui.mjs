import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../services/browser-cloud/public/', import.meta.url), { recursive: true });
await copyFile(new URL('../browser.html', import.meta.url),
  new URL('../services/browser-cloud/public/browser.html', import.meta.url));
