import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = [];
for (const root of ['src', 'bin', 'scripts', 'test']) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root, { recursive: true })) if (name.endsWith('.js')) files.push(`${root}/${name}`);
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
