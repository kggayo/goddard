import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWrite, hash } from './util.js';

export const maxImageBytes = 5 * 1024 * 1024;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export function imageFromBytes(bytes, name = 'clipboard.png') {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('The image is empty.');
  if (bytes.length > maxImageBytes) throw new Error('Each image must be at most 5 MiB.');
  const mediaType = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
    : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) ? 'image/gif'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (!mediaType) throw new Error('Unsupported image. Use a PNG, JPEG, GIF, or WebP file.');
  return { name: path.basename(name), mediaType, size: bytes.length, hash: hash(bytes), bytes };
}

export function readImage(file, base = process.cwd()) {
  const input = file.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!input || /[\r\n\0]/.test(input)) throw new Error('Provide one image path, optionally surrounded by quotes.');
  const resolved = path.resolve(base, input);
  let fd;
  try {
    if (!fs.statSync(resolved).isFile()) throw new Error('The image path must be a file.');
    fd = fs.openSync(resolved, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('The image path must be a file.');
    if (stat.size > maxImageBytes) throw new Error('Each image must be at most 5 MiB.');
    // Bound the read even if another process grows the file after stat.
    const bytes = Buffer.alloc(Math.min(stat.size + 1, maxImageBytes + 1));
    let size = 0, count;
    while (size < bytes.length && (count = fs.readSync(fd, bytes, size, bytes.length - size, null))) size += count;
    if (size !== stat.size) throw new Error('The image changed while being read. Try attaching it again.');
    return imageFromBytes(bytes.subarray(0, size), resolved);
  } catch (error) { throw new Error(`Cannot attach ${input}: ${error.message}`); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function imageMetadata({ name, mediaType, size, hash: digest }) {
  return { name, mediaType, size, hash: digest };
}

export function checkImageLimits(images) {
  const unique = [...new Map(images.map(image => [image.hash, image])).values()];
  if (unique.length > 10 || unique.reduce((sum, image) => sum + image.size, 0) > 20 * 1024 * 1024)
    throw new Error('A task can retain up to 10 images and 20 MiB of image data. Start a new task for more images.');
}

export function rememberImages(store, task, images = [], run = null) {
  const checked = images.map(image => imageFromBytes(image.bytes, image.name));
  const existing = store.images(task);
  checkImageLimits([...existing, ...checked]);
  const known = new Set(existing.map(image => image.hash)), added = [];
  for (const image of checked) {
    if (known.has(image.hash)) continue;
    store.putObject(image.bytes);
    added.push(imageMetadata(image)); known.add(image.hash);
  }
  if (added.length) store.event(task, run, 'user.images', { images: added });
  return checked.map(image => materializeImage(store, task, image));
}

function materializeImage(store, task, image) {
  const file = path.join(store.taskDir(task), 'images', `${image.hash}.${extensions[image.mediaType]}`);
  // Rebuild the provider-readable copy from the verified object on every send.
  atomicWrite(file, image.bytes);
  return { ...image, path: file };
}

export function loadImages(store, task) {
  return store.images(task).map(meta => materializeImage(store, task, imageFromBytes(store.getObject(meta.hash), meta.name)));
}

export function bundleImages(bundle) {
  if (bundle.images === undefined) return [];
  if (!Array.isArray(bundle.images) || bundle.images.length > 10) throw new Error('Invalid bundle images: at most 10 attachments are allowed.');
  const seen = new Set();
  const images = bundle.images.map(meta => {
    if (typeof meta?.name !== 'string' || !/^[a-f0-9]{64}$/.test(meta.hash) || typeof bundle.objects?.[meta.hash] !== 'string')
      throw new Error('Invalid bundle image metadata.');
    if (seen.has(meta.hash)) throw new Error('Duplicate bundle image.');
    seen.add(meta.hash);
    if (bundle.objects[meta.hash].length > Math.ceil(maxImageBytes / 3) * 4) throw new Error('Bundle image exceeds 5 MiB.');
    const image = imageFromBytes(Buffer.from(bundle.objects[meta.hash], 'base64'), meta.name);
    if (image.hash !== meta.hash || image.mediaType !== meta.mediaType || image.size !== meta.size) throw new Error('Corrupt bundle image.');
    return image;
  });
  checkImageLimits(images);
  return images;
}

export function imageFilename(image) { return `${image.hash}.${extensions[image.mediaType]}`; }

// A clipboard read is only triggered by /paste or the image-paste shortcut.
// No image data or user paths are interpolated into the PowerShell program.
export async function readClipboardImage({ platform = process.platform, run = promisify(execFile), signal } = {}) {
  if (platform !== 'win32') throw new Error('Clipboard images currently require Windows. Save the image and use /image PATH.');
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$picture = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $picture) { throw 'Clipboard does not contain an image. Copy an image or screenshot first.' }
$stream = New-Object System.IO.MemoryStream
try {
  $picture.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($stream.Length -gt 5242880) { throw 'Each image must be at most 5 MiB.' }
  [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))
} finally { $stream.Dispose(); $picture.Dispose() }`;
  try {
    const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024, signal });
    return imageFromBytes(Buffer.from(stdout.trim(), 'base64'));
  } catch (error) {
    if (signal?.aborted) throw error;
    const detail = error.stderr?.trim().split(/\r?\n/)[0];
    throw new Error(detail || 'Could not read the clipboard image. Save it and use /image PATH.');
  }
}
