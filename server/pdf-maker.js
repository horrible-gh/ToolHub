import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';

export const PUBLIC_ERRORS = Object.freeze({
  UNSUPPORTED_FORMAT: 'This file type is not supported.',
  FILE_TOO_LARGE: 'The file exceeds the allowed size.',
  INVALID_DOCUMENT: 'The document is damaged or does not match its file type.',
  ENCRYPTED_DOCUMENT: 'Password-protected documents cannot be converted.',
  QUEUE_FULL: 'The converter is busy. Try again later.',
  CONVERSION_TIMEOUT: 'The conversion took too long.',
  CONVERTER_FAILED: 'The document could not be converted.',
  INVALID_PDF: 'The converter produced an invalid PDF.',
  EXPIRED: 'This conversion is no longer available.'
});

const terminal = new Set(['succeeded', 'failed', 'expired']);
const allowedTransitions = new Map([
  ['accepted', new Set(['queued', 'failed', 'expired'])],
  ['queued', new Set(['converting', 'failed', 'expired'])],
  ['converting', new Set(['succeeded', 'failed', 'expired'])],
  ['succeeded', new Set(['expired'])],
  ['failed', new Set(['expired'])]
]);

function publicFailure(code) { return { code, message: PUBLIC_ERRORS[code] || PUBLIC_ERRORS.CONVERTER_FAILED }; }
function timingSafeToken(actual, expectedHash) {
  if (typeof actual !== 'string' || !/^[A-Za-z0-9_-]{32,160}$/.test(actual)) return false;
  const digest = crypto.createHash('sha256').update(actual).digest();
  return digest.length === expectedHash.length && crypto.timingSafeEqual(digest, expectedHash);
}
function tokenFrom(req) {
  const auth = req.get('authorization') || '';
  if (/^Bearer [A-Za-z0-9_-]+$/.test(auth)) return auth.slice(7);
  return req.get('x-pdf-maker-token') || '';
}
function transition(file, next, logger, job) {
  if (file.status === next) return;
  if (!allowedTransitions.get(file.status)?.has(next)) throw Object.assign(new Error('invalid file state transition'), { code: 'INVALID_STATE' });
  const previous = file.status; file.status = next;
  logger.info?.(JSON.stringify({ event: 'pdf_maker_state', jobId: job.id, fileId: file.id, from: previous, to: next }));
}
function displayName(raw) {
  const leaf = String(raw || 'document').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '/').split('/').pop().normalize('NFKC').trim();
  return (leaf || 'document').slice(0, 180);
}
function safeStem(name) {
  return path.basename(name, path.extname(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || 'document';
}
function contentDisposition(filename) {
  const unicodeName = `${safeStem(filename)}.pdf`;
  const asciiStem = safeStem(filename).replace(/[^\x20-\x7e]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'document';
  const encoded = encodeURIComponent(unicodeName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiStem}.pdf"; filename*=UTF-8''${encoded}`;
}
const cfbSignature = Buffer.from('d0cf11e0a1b11ae1', 'hex');
function isEncryptedOfficeContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 512 || !buffer.subarray(0, 8).equals(cfbSignature)) return false;
  try {
    if (buffer.readUInt16LE(28) !== 0xfffe) return false;
    const sectorSize = 2 ** buffer.readUInt16LE(30);
    if (![512, 4096].includes(sectorSize) || buffer.length < 512 + sectorSize) return false;
    const sector = (id) => {
      const offset = 512 + id * sectorSize;
      if (id < 0 || offset + sectorSize > buffer.length) throw new Error('invalid CFB sector');
      return buffer.subarray(offset, offset + sectorSize);
    };
    const freeSector = -1; const endOfChain = -2;
    const fatSectorIds = []; const fatCount = buffer.readUInt32LE(44);
    for (let index = 0; index < 109 && fatSectorIds.length < fatCount; index += 1) {
      const id = buffer.readInt32LE(76 + index * 4);
      if (id >= 0) fatSectorIds.push(id);
    }
    const difatCount = buffer.readUInt32LE(72); const difatSeen = new Set();
    let difatId = buffer.readInt32LE(68);
    for (let chainIndex = 0; chainIndex < difatCount; chainIndex += 1) {
      if (difatId < 0 || difatSeen.has(difatId)) return false;
      difatSeen.add(difatId); const difat = sector(difatId);
      for (let offset = 0; offset < sectorSize - 4 && fatSectorIds.length < fatCount; offset += 4) {
        const id = difat.readInt32LE(offset);
        if (id >= 0) fatSectorIds.push(id); else if (id !== freeSector) return false;
      }
      difatId = difat.readInt32LE(sectorSize - 4);
    }
    if (difatId !== endOfChain || fatSectorIds.length !== fatCount || new Set(fatSectorIds).size !== fatSectorIds.length) return false;
    const fat = Buffer.concat(fatSectorIds.map(sector));
    const directoryChunks = []; const seen = new Set();
    let directoryId = buffer.readInt32LE(48);
    while (directoryId >= 0 && !seen.has(directoryId)) {
      seen.add(directoryId); directoryChunks.push(sector(directoryId));
      const fatOffset = directoryId * 4;
      if (fatOffset + 4 > fat.length) return false;
      directoryId = fat.readInt32LE(fatOffset);
    }
    if (directoryId !== endOfChain) return false;
    const directory = Buffer.concat(directoryChunks); const streams = new Set();
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const nameBytes = directory.readUInt16LE(offset + 64); const type = directory[offset + 66];
      if (type !== 2 || nameBytes < 2 || nameBytes > 64 || nameBytes % 2) continue;
      streams.add(directory.subarray(offset, offset + nameBytes - 2).toString('utf16le'));
    }
    return streams.has('EncryptionInfo') && streams.has('EncryptedPackage');
  } catch { return false; }
}
function zipEntries(buffer) {
  let end = -1;
  for (let i = Math.max(0, buffer.length - 65557); i + 22 <= buffer.length; i += 1) if (buffer.readUInt32LE(i) === 0x06054b50) end = i;
  if (end < 0) throw Object.assign(new Error('zip directory is missing'), { code: 'INVALID_DOCUMENT' });
  const count = buffer.readUInt16LE(end + 10); let cursor = buffer.readUInt32LE(end + 16); const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw Object.assign(new Error('invalid zip directory'), { code: 'INVALID_DOCUMENT' });
    const flags = buffer.readUInt16LE(cursor + 8); const nameLength = buffer.readUInt16LE(cursor + 28); const extraLength = buffer.readUInt16LE(cursor + 30); const commentLength = buffer.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength; if (next > buffer.length) throw Object.assign(new Error('invalid zip entry'), { code: 'INVALID_DOCUMENT' });
    entries.push({ name: buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1'), encrypted: Boolean(flags & 1) }); cursor = next;
  }
  return entries;
}
export function inspectOoxml(buffer, extension) {
  if (isEncryptedOfficeContainer(buffer)) return publicFailure('ENCRYPTED_DOCUMENT');
  if (!Buffer.isBuffer(buffer) || buffer.length < 32 || buffer.readUInt32LE(0) !== 0x04034b50) return publicFailure('INVALID_DOCUMENT');
  let entries; try { entries = zipEntries(buffer); } catch (error) { return publicFailure(error.code || 'INVALID_DOCUMENT'); }
  const names = new Set(entries.map(({ name }) => name));
  if (entries.some(({ encrypted }) => encrypted) || names.has('EncryptionInfo') || names.has('EncryptedPackage')) return publicFailure('ENCRYPTED_DOCUMENT');
  const required = extension === '.docx' ? 'word/document.xml' : extension === '.pptx' ? 'ppt/presentation.xml' : '';
  if (!required || !names.has('[Content_Types].xml') || !names.has('_rels/.rels') || !names.has(required)) return publicFailure('INVALID_DOCUMENT');
  return null;
}
function parseDisposition(value) {
  const match = /name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(value || '');
  return match ? { field: match[1], filename: match[2] === undefined ? undefined : Buffer.from(match[2], 'latin1').toString('utf8') } : null;
}
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!match) throw Object.assign(new Error('multipart boundary is required'), { status: 400, code: 'INVALID_REQUEST' });
  const boundary = Buffer.from(`--${match[1] || match[2]}`); const parts = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor >= 0) {
    const headerStart = cursor + boundary.length;
    if (buffer.subarray(headerStart, headerStart + 2).toString() === '--') break;
    if (buffer.subarray(headerStart, headerStart + 2).toString() !== '\r\n') throw Object.assign(new Error('invalid multipart body'), { status: 400, code: 'INVALID_REQUEST' });
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart + 2);
    if (headerEnd < 0) throw Object.assign(new Error('invalid multipart body'), { status: 400, code: 'INVALID_REQUEST' });
    const next = buffer.indexOf(boundary, headerEnd + 4); if (next < 0) throw Object.assign(new Error('invalid multipart body'), { status: 400, code: 'INVALID_REQUEST' });
    const headers = Object.fromEntries(buffer.subarray(headerStart + 2, headerEnd).toString('latin1').split('\r\n').map((line) => { const at = line.indexOf(':'); return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()]; }));
    const disposition = parseDisposition(headers['content-disposition']);
    if (disposition?.filename !== undefined) parts.push({ ...disposition, contentType: headers['content-type'] || 'application/octet-stream', data: buffer.subarray(headerEnd + 4, next - 2) });
    cursor = next;
  }
  return parts;
}
function validPdf(buffer) { return buffer.length >= 12 && buffer.subarray(0, 5).toString() === '%PDF-' && buffer.subarray(-1024).includes(Buffer.from('%%EOF')); }
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function makeZip(items) {
  const local = []; const central = []; let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name); const data = item.data; const crc = crc32(data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    local.push(head, name, data);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name); offset += head.length + name.length + data.length;
  }
  const center = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, center, end]);
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      const done = () => resolve(); killer.once('error', done); killer.once('exit', done);
      setTimeout(done, 2000).unref();
    });
    try { child.kill('SIGKILL'); } catch {}
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }
}
async function runConverterProcess({ executable, args, outputDir, timeoutMs, spawnImpl = spawn, killImpl, env }) {
  await new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, { cwd: outputDir, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore', env });
    let settled = false; let timingOut = false;
    const finish = (callback) => { if (settled) return; settled = true; clearTimeout(timer); callback(); };
    const timer = setTimeout(() => {
      timingOut = true;
      void (async () => {
        try { await Promise.race([Promise.resolve(killImpl ? killImpl(child) : terminateProcessTree(child)), delay(2500)]); } catch {}
        finish(() => reject(Object.assign(new Error('conversion timeout'), { code: 'CONVERSION_TIMEOUT' })));
      })();
    }, timeoutMs);
    child.once('error', (error) => { if (!timingOut) finish(() => reject(Object.assign(error, { code: 'CONVERTER_FAILED' }))); });
    child.once('exit', (code) => { if (!timingOut) finish(() => code !== 0 ? reject(Object.assign(new Error('converter exited unsuccessfully'), { code: 'CONVERTER_FAILED' })) : resolve()); });
  });
}
export async function libreOfficeConverter({ inputPath, outputDir, profileDir, timeoutMs, executable = 'libreoffice', spawnImpl = spawn, killImpl }) {
  await fsp.mkdir(outputDir, { recursive: true }); await fsp.mkdir(profileDir, { recursive: true });
  const args = ['--headless', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard', `-env:UserInstallation=${new URL(`file://${path.resolve(profileDir).replace(/\\/g, '/')}`).href}`, '--convert-to', 'pdf', '--outdir', outputDir, inputPath];
  await runConverterProcess({ executable, args, outputDir, timeoutMs, spawnImpl, killImpl });
  return path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
}
const officeScript = `
$ErrorActionPreference = 'Stop'
$inputPath = $env:PDF_MAKER_INPUT
$outputPath = $env:PDF_MAKER_OUTPUT
$extension = [IO.Path]::GetExtension($inputPath).ToLowerInvariant()
$app = $item = $null
try {
  if ($extension -eq '.docx') {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false
    $app.DisplayAlerts = 0
    $app.AutomationSecurity = 3
    $missing = [Type]::Missing
    $item = $app.Documents.Open($inputPath, $false, $true, $false, '__pdf_maker_nopass__', '__pdf_maker_nopass__', $false, '__pdf_maker_nopass__', '__pdf_maker_nopass__', $missing, $missing, $false, $true, $missing, $true)
    $item.ExportAsFixedFormat($outputPath, 17)
  } elseif ($extension -eq '.pptx') {
    $app = New-Object -ComObject PowerPoint.Application
    try { $app.DisplayAlerts = 1 } catch {}
    $app.AutomationSecurity = 3
    $item = $app.Presentations.Open($inputPath, -1, 0, 0)
    try { $item.ExportAsFixedFormat($outputPath, 2) } catch { $item.SaveAs($outputPath, 32) }
  } else { throw 'unsupported Office extension' }
} finally {
  if ($null -ne $item) { try { $item.Close() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item) }
  if ($null -ne $app) { try { $app.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
`;
export async function officeConverter({ inputPath, outputDir, timeoutMs, executable = 'powershell.exe', spawnImpl = spawn, killImpl }) {
  await fsp.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
  const encoded = Buffer.from(officeScript, 'utf16le').toString('base64');
  const env = { ...process.env, PDF_MAKER_INPUT: path.resolve(inputPath), PDF_MAKER_OUTPUT: path.resolve(outputPath) };
  await runConverterProcess({ executable, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], outputDir, timeoutMs, spawnImpl, killImpl, env });
  return outputPath;
}

export function createPdfMaker({ config, converter, logger = console, now = () => Date.now(), startCleanup = true, removePath = fsp.rm } = {}) {
  if (!config) throw new TypeError('pdf-maker config is required');
  const engine = config.engine || 'libreoffice';
  const selectedConverter = converter || (engine === 'office' ? officeConverter : libreOfficeConverter);
  const jobs = new Map(); const queue = []; let running = 0; let closed = false;
  fs.mkdirSync(config.storageRoot, { recursive: true, mode: 0o700 });
  const runtimeRoot = path.resolve(config.runtimeRoot || path.join(os.tmpdir(), 'toolhub-pdf-maker-runtime'));
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const log = (level, value) => logger[level]?.(JSON.stringify(value));
  const removeJob = async (job, reason = 'explicit') => {
    if (job.cleaned) return false; job.cleaned = true;
    for (const file of job.files) if (!terminal.has(file.status)) transition(file, 'expired', logger, job); else if (file.status !== 'expired') transition(file, 'expired', logger, job);
    try { await removePath(job.root, { recursive: true, force: true }); jobs.delete(job.id); log('info', { event: 'pdf_maker_cleanup', jobId: job.id, reason, removed: true }); return true; }
    catch { job.cleaned = false; log('warn', { event: 'pdf_maker_cleanup', jobId: job.id, reason, removed: false }); return false; }
  };
  const pump = () => {
    while (!closed && running < config.concurrency && queue.length) {
      const task = queue.shift(); running += 1;
      void task().finally(() => { running -= 1; pump(); });
    }
  };
  const enqueue = (task) => { if (queue.length + running >= config.queueLimit) return false; queue.push(task); pump(); return true; };
  const runFile = async (job, file) => {
    if (job.cleaned) return; transition(file, 'converting', logger, job); const began = now();
    const workDir = path.join(job.root, 'work', file.id); let runtimeDir;
    try {
      await fsp.mkdir(workDir, { recursive: true });
      runtimeDir = await fsp.mkdtemp(path.join(runtimeRoot, 'c-'));
      const inputPath = path.join(runtimeDir, `i${path.extname(file.inputPath)}`);
      const stagedDir = path.join(runtimeDir, 'o'); const profileDir = path.join(runtimeDir, 'p');
      await Promise.all([fsp.copyFile(file.inputPath, inputPath), fsp.mkdir(stagedDir), fsp.mkdir(profileDir)]);
      const candidate = await selectedConverter({ inputPath, outputDir: stagedDir, profileDir, timeoutMs: config.timeoutMs, executable: engine === 'office' ? config.powershellPath : config.libreOfficePath, jobId: job.id, fileId: file.id });
      if (job.cleaned) return;
      const realRuntime = await fsp.realpath(runtimeDir); const realStaged = await fsp.realpath(stagedDir); const realCandidate = await fsp.realpath(candidate);
      const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
      const [runtimeInfo, stagedInfo, candidateInfo] = await Promise.all([fsp.lstat(runtimeDir), fsp.lstat(stagedDir), fsp.lstat(candidate)]);
      if (runtimeInfo.isSymbolicLink() || !within(realRuntime, realStaged) || stagedInfo.isSymbolicLink() || candidateInfo.isSymbolicLink() || !within(realStaged, realCandidate)) {
        throw Object.assign(new Error('converter output escaped runtime root'), { code: 'INVALID_PDF' });
      }
      const realRoot = await fsp.realpath(job.root); const realResults = await fsp.realpath(path.join(job.root, 'results'));
      if (!within(realRoot, realResults)) throw Object.assign(new Error('result directory escaped job root'), { code: 'INVALID_PDF' });
      const pdf = await fsp.readFile(realCandidate); if (!validPdf(pdf)) throw Object.assign(new Error('invalid pdf'), { code: 'INVALID_PDF' });
      const destination = path.join(realResults, `${file.id}.pdf`); await fsp.writeFile(destination, pdf, { flag: 'wx' }); file.resultPath = destination; file.resultSize = pdf.length; transition(file, 'succeeded', logger, job);
    } catch (error) { if (!job.cleaned) { file.error = publicFailure(error.code === 'CONVERSION_TIMEOUT' ? 'CONVERSION_TIMEOUT' : error.code === 'INVALID_PDF' ? 'INVALID_PDF' : 'CONVERTER_FAILED'); transition(file, 'failed', logger, job); } }
    finally { await Promise.allSettled([fsp.rm(workDir, { recursive: true, force: true }), runtimeDir ? fsp.rm(runtimeDir, { recursive: true, force: true }) : Promise.resolve()]); if (job.cleaned) await fsp.rm(job.root, { recursive: true, force: true }); log('info', { event: 'pdf_maker_conversion', jobId: job.id, fileId: file.id, status: file.status, errorCode: file.error?.code || null, durationMs: now() - began, engine }); }
  };
  const summary = (job) => {
    const counts = job.files.reduce((a, f) => { a[f.status] = (a[f.status] || 0) + 1; return a; }, {});
    const done = job.files.every((file) => terminal.has(file.status)); const succeeded = counts.succeeded || 0; const failed = counts.failed || 0;
    return { jobId: job.id, status: done ? succeeded && failed ? 'partial' : succeeded ? 'succeeded' : 'failed' : 'processing', counts: { total: job.files.length, succeeded, failed, pending: job.files.length - succeeded - failed }, expiresAt: new Date(job.expiresAt).toISOString(), files: job.files.map((file) => ({ id: file.id, name: file.name, status: file.status, error: file.error || null, downloadable: file.status === 'succeeded' })) };
  };
  const lookup = (req, res) => {
    const job = jobs.get(req.params.jobId); if (!job || job.cleaned || now() >= job.expiresAt) { res.status(410).json({ error: publicFailure('EXPIRED') }); return null; }
    if (!timingSafeToken(tokenFrom(req), job.tokenHash)) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversion not found.' } }); return null; }
    return job;
  };
  const router = express.Router();
  router.post('/jobs', express.raw({ type: 'multipart/form-data', limit: config.requestMaxBytes + 64 * 1024 }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: { code: 'INVALID_REQUEST', message: 'Use multipart/form-data.' } });
    let uploads; try { uploads = parseMultipart(req.body, req.get('content-type')); } catch (error) { return res.status(error.status || 400).json({ error: { code: error.code || 'INVALID_REQUEST', message: 'The upload request is invalid.' } }); }
    if (!uploads.length || uploads.length > config.maxFiles) return res.status(413).json({ error: { code: uploads.length ? 'TOO_MANY_FILES' : 'NO_FILES', message: uploads.length ? 'Too many files were uploaded.' : 'At least one file is required.' } });
    const total = uploads.reduce((n, item) => n + item.data.length, 0); if (total > config.requestMaxBytes) return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'The upload request is too large.' } });
    if (queue.length + running >= config.queueLimit) return res.status(503).set('Retry-After', '5').json({ error: publicFailure('QUEUE_FULL') });
    const id = crypto.randomUUID(); const token = crypto.randomBytes(32).toString('base64url'); const root = path.join(config.storageRoot, id);
    const job = { id, root, tokenHash: crypto.createHash('sha256').update(token).digest(), createdAt: now(), expiresAt: now() + config.retentionMs, files: [], cleaned: false };
    await Promise.all(['inputs', 'work', 'staged', 'results', 'profiles'].map((name) => fsp.mkdir(path.join(root, name), { recursive: true, mode: 0o700 })));
    for (const upload of uploads) {
      const file = { id: crypto.randomUUID(), name: displayName(upload.filename), status: 'accepted', error: null };
      const rawName = String(upload.filename || ''); const extension = path.extname(file.name).toLowerCase();
      if (rawName.includes('/') || rawName.includes('\\') || !config.allowedExtensions.includes(extension)) file.error = publicFailure('UNSUPPORTED_FORMAT');
      else if (!upload.data.length) file.error = publicFailure('INVALID_DOCUMENT');
      else if (upload.data.length > config.fileMaxBytes) file.error = publicFailure('FILE_TOO_LARGE');
      else file.error = inspectOoxml(upload.data, extension);
      job.files.push(file);
      if (file.error) transition(file, 'failed', logger, job);
      else { file.inputPath = path.join(root, 'inputs', `${file.id}${extension}`); await fsp.writeFile(file.inputPath, upload.data, { mode: 0o600 }); transition(file, 'queued', logger, job); }
    }
    jobs.set(id, job);
    for (const file of job.files.filter((item) => item.status === 'queued')) if (!enqueue(() => runFile(job, file))) { file.error = publicFailure('QUEUE_FULL'); transition(file, 'failed', logger, job); }
    log('info', { event: 'pdf_maker_accepted', requestId: req.id, jobId: id, fileCount: job.files.length, acceptedCount: job.files.filter((f) => f.status !== 'failed').length });
    return res.status(202).set('Cache-Control', 'no-store').json({ ...summary(job), accessToken: token });
  });
  router.get('/jobs/:jobId', (req, res) => { const job = lookup(req, res); if (job) res.set('Cache-Control', 'no-store').json(summary(job)); });
  router.get('/jobs/:jobId/files/:fileId', async (req, res) => {
    const job = lookup(req, res); if (!job) return; const file = job.files.find((item) => item.id === req.params.fileId && item.status === 'succeeded');
    if (!file) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'PDF not found.' } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(file.name), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).sendFile(file.resultPath);
  });
  router.get('/jobs/:jobId/results.zip', async (req, res) => {
    const job = lookup(req, res); if (!job) return; const successful = job.files.filter((f) => f.status === 'succeeded');
    if (!successful.length) return res.status(409).json({ error: { code: 'NO_RESULTS', message: 'No converted PDFs are available.' } });
    const used = new Set(); const items = [];
    for (const file of successful) {
      const stem = safeStem(file.name); let suffix = 1; let name = `${stem}.pdf`;
      while (used.has(name.toLowerCase())) { suffix += 1; name = `${stem} (${suffix}).pdf`; }
      used.add(name.toLowerCase()); items.push({ name, data: await fsp.readFile(file.resultPath) });
    }
    const zip = makeZip(items); res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="pdf-maker-results.zip"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-PDF-Maker-Included': String(items.length), 'X-PDF-Maker-Excluded': String(job.files.length - items.length) }).send(zip);
  });
  router.delete('/jobs/:jobId', async (req, res) => { const job = lookup(req, res); if (!job) return; await removeJob(job); res.status(204).end(); });
  const cleanupExpired = async () => { const expired = [...jobs.values()].filter((job) => now() >= job.expiresAt); return Promise.all(expired.map((job) => removeJob(job, 'expired'))); };
  const timer = startCleanup ? setInterval(() => void cleanupExpired(), config.cleanupIntervalMs) : null; timer?.unref();
  const close = async () => { closed = true; if (timer) clearInterval(timer); queue.length = 0; for (const job of jobs.values()) for (const file of job.files.filter((item) => item.status === 'queued')) { file.error = publicFailure('CONVERTER_FAILED'); transition(file, 'failed', logger, job); } while (running) await new Promise((resolve) => setTimeout(resolve, 10)); };
  return { router, cleanupExpired, close, jobs, summary };
}
