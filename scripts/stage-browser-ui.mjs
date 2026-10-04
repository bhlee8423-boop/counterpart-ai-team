import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../browser.html', import.meta.url),
  new URL('../services/browser-cloud/browser.html', import.meta.url));
