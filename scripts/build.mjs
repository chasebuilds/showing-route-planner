// Static site: copy the runtime files into dist/. No bundler, the app is plain ES modules.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'src', 'vendor', 'icons']) {
  cpSync(join(root, f), join(out, f), { recursive: true });
}
console.log('built dist/');
