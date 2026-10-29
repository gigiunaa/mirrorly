// Builds dist/mirrorly-<version>.zip for the Chrome Web Store and Edge Add-ons.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extensionDir = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const distDir = path.join(root, 'dist');
const zip = path.join(distDir, `mirrorly-${version}.zip`);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(zip, { force: true });
// Compress-Archive in Windows PowerShell writes "\" in entry names, which the stores reject.
const files = fs.readdirSync(extensionDir, { recursive: true })
  .filter((rel) => fs.statSync(path.join(extensionDir, rel)).isFile())
  .map((rel) => rel.split(path.sep).join('/'));
const script = [
  'Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem',
  `$zip = [System.IO.Compression.ZipFile]::Open('${zip}', 'Create')`,
  ...files.map((rel) =>
    `[void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, '${path.join(extensionDir, rel)}', '${rel}')`),
  '$zip.Dispose()',
].join('; ');
execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
console.log('written:', path.relative(root, zip));
