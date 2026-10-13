import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { setup, temp } from './helpers.js';
import { main } from '../src/cli.js';
import { checkImageLimits, imageFromBytes, imageFilename, loadImages, maxImageBytes, readClipboardImage, readImage, rememberImages } from '../src/images.js';
import { exportBundle, importBundle, readBundle, unpackBundle } from '../src/handoff.js';
import { Interaction } from '../src/interaction.js';
import { supervise } from '../src/supervisor.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import { ClaudeAdapter } from '../src/adapters/claude.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const fixture = fileURLToPath(new URL('./fixtures/interactive-provider.js', import.meta.url));

function terminal(t, responses = [], options = {}) {
  const input = new PassThrough(), output = new PassThrough();
  let transcript = '';
  const ui = new Interaction({ input, output, ...options });
  t.after(() => ui.close());
  output.on('data', chunk => {
    transcript += chunk;
    if (/You \(|Answer \(|Allow this request/.test(chunk.toString())) setImmediate(() => {
      const next = responses.shift();
      if (next === undefined) input.end(); else input.write(next + '\n');
    });
  });
  return { ui, input, output, transcript: () => transcript };
}

test('image paths support Windows-style surrounding quotes and detect formats from bytes', t => {
  const dir = temp(t), file = path.join(dir, 'screenshot with spaces.bin');
  fs.writeFileSync(file, png);
  assert.deepEqual(readImage('"screenshot with spaces.bin"', dir).bytes, png);
  assert.equal(readImage(`'${file}'`).mediaType, 'image/png');
  assert.equal(imageFromBytes(gif).mediaType, 'image/gif');
  assert.equal(imageFromBytes(Buffer.from('ffd8ffe0', 'hex')).mediaType, 'image/jpeg');
  assert.equal(imageFromBytes(Buffer.from('RIFF0000WEBP')).mediaType, 'image/webp');
  assert.throws(() => readImage(dir), /must be a file/);
  assert.throws(() => readImage('missing.png', dir), /Cannot attach/);
  assert.throws(() => readImage('one.png\ntwo.png', dir), /one image path/);
  assert.throws(() => imageFromBytes(Buffer.from('<svg/>')), /Unsupported image/);
  assert.throws(() => imageFromBytes(Buffer.alloc(0)), /empty/);
  const large = Buffer.alloc(maxImageBytes + 1); png.copy(large);
  fs.writeFileSync(file, large);
  assert.throws(() => readImage(file), /at most 5 MiB/);
  assert.throws(() => checkImageLimits(Array.from({ length: 11 }, (_, hash) => ({ hash, size: 1 }))), /10 images/);
  assert.throws(() => checkImageLimits(Array.from({ length: 5 }, (_, hash) => ({ hash, size: maxImageBytes }))), /20 MiB/);
});

test('start and run accept repeated shared image flags and validate before creating a task', async t => {
  const { dir, store, task } = setup(t);
  t.mock.method(console, 'log', () => {});
  const oldExitCode = process.exitCode; t.after(() => { process.exitCode = oldExitCode; });
  fs.writeFileSync(path.join(dir, '.goddard', 'screen shot.png'), png);
  fs.writeFileSync(path.join(dir, '.goddard', 'diagram.gif'), gif);
  for (const provider of ['codex', 'claude']) for (const args of [['start', 'Review the screenshot'], ['run', task.id]]) {
    await main([...args, '--workspace', dir, '--agent', provider, '--non-interactive', '--image', '.goddard/screen shot.png', '-i', '.goddard/diagram.gif'], {
      runTask: async (saved, id, options) => {
        assert.equal(options.provider, provider);
        assert.deepEqual(options.images.map(image => image.bytes), [png, gif]);
        return { status: 'finished' };
      }
    });
  }
  const count = store.tasks().length;
  await assert.rejects(main(['start', 'bad image', '--workspace', dir, '--image', 'missing.png']), /Cannot attach/);
  await assert.rejects(main(['new', 'bad command', '--workspace', dir, '--image', '.goddard/diagram.gif']), /supported by start and run/);
  assert.equal(store.tasks().length, count);
});

test('unsent images can be inspected, removed, or discarded without submitting them', async t => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'screen shot.png'), png);
  const h = terminal(t, ['/image missing.png', '/image "screen shot.png"', '/images', '/remove-image 2', '/remove-image 1', 'text only', '/image "screen shot.png"', '/done'], { workspace: dir });
  assert.equal(await h.ui.request({ kind: 'followup' }), 'text only');
  assert.equal(await h.ui.request({ kind: 'followup' }), '/done');
  assert.match(h.transcript(), /Cannot attach/);
  assert.match(h.transcript(), /1\. screen shot.png/);
  assert.match(h.transcript(), /Removed screen shot.png/);
});

test('clipboard commands attach only on submission, handle errors, and allow image-only messages', async t => {
  let reads = 0;
  const h = terminal(t, ['/paste', '/paste', '', '/done'], { clipboard: async () => {
    if (++reads === 1) throw new Error('No clipboard image.');
    return imageFromBytes(png);
  } });
  const result = await h.ui.request({ kind: 'followup' });
  assert.equal(result.text, ''); assert.deepEqual(result.images[0].bytes, png);
  assert.match(h.transcript(), /No clipboard image/);
  assert.equal(await h.ui.request({ kind: 'followup' }), '/done');
  assert.equal(reads, 2);
});

test('canceling a clipboard read cannot attach its image to the next prompt', async t => {
  const controller = new AbortController();
  const h = terminal(t, ['/paste', 'no'], { clipboard: async () => { controller.abort(); return imageFromBytes(png); } });
  assert.equal(await h.ui.request({ kind: 'followup', signal: controller.signal }), null);
  assert.equal(await h.ui.request({ kind: 'approval', title: 'Approve' }), false);
  assert.doesNotMatch(h.transcript(), /Attached image/);
});

test('Windows clipboard helper returns PNG bytes and fails clearly on other platforms', async () => {
  let calls = 0;
  const image = await readClipboardImage({ platform: 'win32', run: async (command, args, options) => {
    calls++;
    assert.equal(command, 'powershell.exe'); assert.ok(args.includes('-STA'));
    assert.equal(options.windowsHide, true); assert.equal(options.timeout, 10000);
    assert.match(Buffer.from(args.at(-1), 'base64').toString('utf16le'), /Clipboard\]::GetImage/);
    return { stdout: png.toString('base64') };
  } });
  assert.deepEqual(image.bytes, png); assert.equal(calls, 1);
  await assert.rejects(readClipboardImage({ platform: 'linux' }), /use \/image PATH/);
  await assert.rejects(readClipboardImage({ platform: 'win32', run: async () => { throw { stderr: 'Clipboard does not contain an image.\r\nDetails' }; } }), /does not contain an image/);
});

for (const [provider, Adapter] of [['codex', CodexAdapter], ['claude', ClaudeAdapter]]) {
  test(`${provider} receives initial and follow-up images, then restores both in a fresh session`, async t => {
    const { dir, store, task } = setup(t);
    const file = path.join(dir, '.goddard', 'follow up.gif'); fs.writeFileSync(file, gif);
    const h = terminal(t, ['1', 'yes', '/image ".goddard/follow up.gif"', 'Compare these images.', '/done'], { workspace: dir });
    const adapter = () => new Adapter({ workspace: dir, binary: process.execPath, args: [fixture, provider, 'interactive'], interactive: true });
    const result = await supervise(store, task.id, { provider, adapter: adapter(), interaction: h.ui, images: [imageFromBytes(png, 'initial.png')], maxSeconds: 5, log: () => {} });
    assert.equal(result.status, 'finished');
    assert.equal(store.images(task.id).length, 2);
    const note = store.notes(task.id).find(note => note.text === 'Compare these images.');
    assert.equal(note.images[0].hash, imageFromBytes(gif).hash);
    fs.unlinkSync(file);
    const resumed = await supervise(store, task.id, { provider, adapter: adapter(), maxSeconds: 5, log: () => {} });
    assert.equal(resumed.status, 'finished');
    const prompts = fs.readFileSync(path.join(dir, 'prompts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const sent = prompts.map(prompt => provider === 'codex'
      ? prompt.input.filter(item => item.type === 'localImage').map(item => fs.readFileSync(item.path))
      : prompt.filter(item => item.type === 'image').map(item => Buffer.from(item.source.data, 'base64')));
    assert.deepEqual(sent, [[png], [gif], [png, gif]]);
    const text = provider === 'codex' ? prompts[1].input[0].text : prompts[1][0].text;
    assert.equal(text, 'Compare these images.');
    assert.ok(!JSON.stringify(store.events(task.id, 1000)).includes(png.toString('base64')));
    assert.match(fs.readFileSync(resumed.handoff, 'utf8'), /initial.png/);
  });
}

test('image snapshots survive source deletion, portable export/import, and tampered display copies', async t => {
  const { dir, store, task } = setup(t);
  const file = path.join(temp(t), 'screenshot.png'); fs.writeFileSync(file, png);
  const [saved] = rememberImages(store, task.id, [readImage(file)]);
  rememberImages(store, task.id, [readImage(file)]);
  assert.equal(store.images(task.id).length, 1);
  fs.unlinkSync(file); fs.writeFileSync(saved.path, 'tampered');
  assert.deepEqual(fs.readFileSync(loadImages(store, task.id)[0].path), png);
  const output = path.join(temp(t), 'handoff.json');
  await exportBundle(store, task.id, output);
  const bundle = readBundle(output);
  const excessive = { ...bundle, images: Array(11).fill(bundle.images[0]) };
  fs.writeFileSync(output, JSON.stringify(excessive));
  assert.throws(() => readBundle(output), /at most 10 attachments/);
  fs.writeFileSync(output, JSON.stringify({ ...bundle, images: [bundle.images[0], bundle.images[0]] }));
  assert.throws(() => readBundle(output), /Duplicate bundle image/);
  fs.writeFileSync(output, JSON.stringify(bundle));
  const destination = setup(t);
  const imported = await importBundle(destination.store, output);
  assert.deepEqual(loadImages(destination.store, imported.id)[0].bytes, png);
  const unpacked = path.join(temp(t), 'review'); unpackBundle(output, unpacked);
  assert.deepEqual(fs.readFileSync(path.join(unpacked, 'images', imageFilename(saved))), png);
  bundle.objects[saved.hash] = gif.toString('base64'); fs.writeFileSync(output, JSON.stringify(bundle));
  await assert.rejects(importBundle(destination.store, output), /Corrupt bundle image/);
  assert.equal(destination.store.tasks().length, 2, 'corrupt bundles must not create a task');
  fs.writeFileSync(path.join(dir, '.goddard', 'objects', saved.hash), 'tampered');
  assert.throws(() => loadImages(store, task.id), /Corrupt workspace object/);
});
