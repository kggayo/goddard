import fs from 'node:fs';
import { createHash } from 'node:crypto';
import './reject-sqlite-loader.mjs';

// Test-only network fixture; production has no endpoint override.
const { version, tarball } = JSON.parse(fs.readFileSync(process.env.GODDARD_TEST_UPDATE_RELEASE, 'utf8'));
const base = `https://github.com/kggayo/goddard/releases/download/v${version}`;
globalThis.fetch = async url => {
  if (url === 'https://api.github.com/repos/kggayo/goddard/releases/latest') return new Response(JSON.stringify({
    tag_name: `v${version}`, draft: false, prerelease: false,
    assets: ['goddard.tgz', 'SHA256SUMS'].map(name => ({ name, browser_download_url: `${base}/${name}` }))
  }));
  if (url === `${base}/SHA256SUMS`) return new Response(`${createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')}  goddard.tgz\n`);
  if (url === `${base}/goddard.tgz`) return new Response(fs.readFileSync(tarball));
  throw new Error(`Unexpected network request: ${url}`);
};
