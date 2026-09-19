import test from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { createApp } from '../server/app.js';
import { defaultLibreOfficePath, loadConfig } from '../server/config.js';
import { inspectMarkdown, inspectOoxml, libreOfficeConverter, makeZip, officeConverter } from '../server/pdf-maker.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const xml = (body) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`, 'utf8');
const corePropsXml = () => xml('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>PDF-Maker fixture</dc:title><dc:creator>ToolHub</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-16T00:00:00Z</dcterms:modified></cp:coreProperties>');
const appPropsXml = (application) => xml(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${application}</Application></Properties>`);
// Real OOXML package structures (matching the parts a genuine Word/PowerPoint save produces),
// not the 3-entry placeholder ZIPs the automated review rejected as unrepresentative.
const realDocx = () => makeZip([
  { name: '[Content_Types].xml', data: xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>') },
  { name: '_rels/.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>') },
  { name: 'word/document.xml', data: xml('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>PDF-Maker fixture document.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>') },
  { name: 'word/_rels/document.xml.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
  { name: 'word/styles.xml', data: xml('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults/><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>') },
  { name: 'docProps/core.xml', data: corePropsXml() },
  { name: 'docProps/app.xml', data: appPropsXml('ToolHub PDF-Maker Fixture (Word)') }
]);
const realPptx = () => makeZip([
  { name: '[Content_Types].xml', data: xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>') },
  { name: '_rels/.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>') },
  { name: 'ppt/presentation.xml', data: xml('<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>') },
  { name: 'ppt/_rels/presentation.xml.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>') },
  { name: 'ppt/slides/slide1.xml', data: xml('<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>PDF-Maker fixture slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>') },
  { name: 'ppt/slides/_rels/slide1.xml.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>') },
  { name: 'ppt/slideLayouts/slideLayout1.xml', data: xml('<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title" preserve="1"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>') },
  { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>') },
  { name: 'ppt/slideMasters/slideMaster1.xml', data: xml('<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>') },
  { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>') },
  { name: 'ppt/theme/theme1.xml', data: xml('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="ToolHub Fixture"><a:themeElements><a:clrScheme name="ToolHub"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="ToolHub"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="ToolHub"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>') },
  { name: 'docProps/core.xml', data: corePropsXml() },
  { name: 'docProps/app.xml', data: appPropsXml('ToolHub PDF-Maker Fixture (PowerPoint)') }
]);
const ooxml = (kind = 'docx') => (kind === 'docx' ? realDocx() : realPptx());
function findLibreOfficeExecutable() {
  const candidate = defaultLibreOfficePath();
  if (path.isAbsolute(candidate)) return fsSync.existsSync(candidate) ? candidate : null;
  return process.platform === 'win32' ? null : candidate;
}
const encryptedOfficeContainer = () => {
  const header = Buffer.alloc(512, 0); const directory = Buffer.alloc(512, 0); const fat = Buffer.alloc(512, 0xff);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header); header.writeUInt16LE(0x003e, 24); header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32); header.writeUInt32LE(1, 44);
  header.writeInt32LE(0, 48); header.writeUInt32LE(4096, 56); header.writeInt32LE(-2, 60); header.writeInt32LE(-2, 68);
  header.writeInt32LE(1, 76); for (let offset = 80; offset < 512; offset += 4) header.writeInt32LE(-1, offset);
  const entry = (index, name, type) => {
    const offset = index * 128; const encoded = Buffer.from(`${name}\0`, 'utf16le'); encoded.copy(directory, offset);
    directory.writeUInt16LE(encoded.length, offset + 64); directory[offset + 66] = type; directory[offset + 67] = 1;
    directory.writeInt32LE(-1, offset + 68); directory.writeInt32LE(-1, offset + 72); directory.writeInt32LE(-1, offset + 76);
    directory.writeInt32LE(-2, offset + 116);
  };
  entry(0, 'Root Entry', 5); entry(1, 'EncryptionInfo', 2); entry(2, 'EncryptedPackage', 2);
  fat.writeInt32LE(-2, 0); fat.writeInt32LE(-3, 4);
  return Buffer.concat([header, directory, fat]);
};
const encryptedOfficeDifatContainer = () => {
  const sectorSize = 512; const header = Buffer.alloc(512, 0); const sectors = Array.from({ length: 112 }, () => Buffer.alloc(sectorSize, 0));
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header); header.writeUInt16LE(0x003e, 24); header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32); header.writeUInt32LE(110, 44);
  header.writeInt32LE(0, 48); header.writeUInt32LE(4096, 56); header.writeInt32LE(-2, 60); header.writeInt32LE(110, 68); header.writeUInt32LE(1, 72);
  for (let index = 0; index < 109; index += 1) header.writeInt32LE(index + 1, 76 + index * 4);
  const entry = (index, name, type) => {
    const offset = index * 128; const encoded = Buffer.from(`${name}\0`, 'utf16le'); encoded.copy(sectors[0], offset);
    sectors[0].writeUInt16LE(encoded.length, offset + 64); sectors[0][offset + 66] = type; sectors[0][offset + 67] = 1;
    sectors[0].writeInt32LE(-1, offset + 68); sectors[0].writeInt32LE(-1, offset + 72); sectors[0].writeInt32LE(-1, offset + 76); sectors[0].writeInt32LE(-2, offset + 116);
  };
  entry(0, 'Root Entry', 5); entry(1, 'EncryptionInfo', 2); entry(2, 'EncryptedPackage', 2);
  for (const fatId of [...Array.from({ length: 109 }, (_, index) => index + 1), 111]) sectors[1].writeInt32LE(-3, fatId * 4);
  sectors[1].writeInt32LE(-2, 0); sectors[1].writeInt32LE(-4, 110 * 4);
  sectors[110].fill(0xff); sectors[110].writeInt32LE(111, 0); sectors[110].writeInt32LE(-2, sectorSize - 4);
  return Buffer.concat([header, ...sectors]);
};
const configFor = (root, overrides = {}) => ({
  allowedExtensions: ['.docx', '.pptx', '.md', '.markdown'], fileMaxBytes: 1024 * 1024, requestMaxBytes: 2 * 1024 * 1024,
  maxFiles: 4, timeoutMs: 1000, concurrency: 2, queueLimit: 8, retentionMs: 60000,
  cleanupIntervalMs: 60000, storageRoot: root, runtimeRoot: path.join(os.tmpdir(), 'th-pdf-rt'), libreOfficePath: 'unused', ...overrides
});
async function harness(t, { converter, markdownConverter, config = {}, logger = { info() {}, warn() {} }, removePath } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toolhub-pdf-maker-test-'));
  const app = createApp({ logger, pdfMakerConfig: configFor(root, config), pdfMakerRemovePath: removePath, pdfMakerMarkdownConverter: markdownConverter, pdfMakerConverter: converter || (async ({ outputDir, inputPath }) => { const result = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`); await fs.writeFile(result, pdf); return result; }) });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.close(); await app.locals.pdfMaker.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { app, root, base: `http://127.0.0.1:${server.address().port}` };
}
async function submit(base, files) {
  const form = new FormData();
  for (const [name, data] of files) form.append('files', new Blob([data]), name);
  return fetch(`${base}/api/pdf-maker/jobs`, { method: 'POST', body: form });
}
async function finished(base, accepted, attempts = 100) {
  for (let count = 0; count < attempts; count += 1) {
    const response = await fetch(`${base}/api/pdf-maker/jobs/${accepted.jobId}`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
    const status = await response.json(); if (['succeeded', 'partial', 'failed'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job did not finish');
}

test('PDF-Maker converts real OOXML-shaped Word and PowerPoint containers and downloads PDFs and ZIP', async (t) => {
  const { base } = await harness(t);
  const response = await submit(base, [['report.docx', ooxml('docx')], ['slides.pptx', ooxml('pptx')]]);
  assert.equal(response.status, 202); const accepted = await response.json();
  assert.match(accepted.accessToken, /^[A-Za-z0-9_-]+$/); assert.equal(JSON.stringify(accepted).includes('inputPath'), false);
  const status = await finished(base, accepted); assert.equal(status.status, 'succeeded'); assert.equal(status.counts.succeeded, 2);
  for (const file of status.files) {
    const download = await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}/files/${file.id}`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
    assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/pdf'); assert.equal(download.headers.get('cache-control'), 'private, no-store'); assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  }
  const zip = await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}/results.zip`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
  assert.equal(zip.status, 200); assert.equal(zip.headers.get('x-pdf-maker-included'), '2'); assert.equal(zip.headers.get('x-pdf-maker-excluded'), '0'); assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 4).toString('hex'), '504b0304');
  assert.equal((await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}`, { headers: { Authorization: 'Bearer ' + 'x'.repeat(43) } })).status, 404);
});

test('PDF-Maker preserves partial success and classifies rejected and failed files safely', async (t) => {
  const { base } = await harness(t, { converter: async ({ outputDir, inputPath }) => { if (inputPath.endsWith('.pptx')) throw Object.assign(new Error('secret converter stderr'), { code: 'CONVERTER_FAILED' }); const result = path.join(outputDir, `${path.basename(inputPath, '.docx')}.pdf`); await fs.writeFile(result, pdf); return result; } });
  const response = await submit(base, [['ok.docx', ooxml('docx')], ['broken.pptx', ooxml('pptx')], ['fake.docx', Buffer.from('not a zip')], ['script.exe', Buffer.from('MZ')]]);
  assert.equal(response.status, 202); const accepted = await response.json(); const status = await finished(base, accepted);
  assert.equal(status.status, 'partial'); assert.equal(status.counts.succeeded, 1); assert.equal(status.counts.failed, 3);
  assert.deepEqual(new Set(status.files.filter((file) => file.error).map((file) => file.error.code)), new Set(['CONVERTER_FAILED', 'INVALID_DOCUMENT', 'UNSUPPORTED_FORMAT']));
  assert.equal(JSON.stringify(status).includes('secret converter stderr'), false);
  const zip = await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}/results.zip`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
  assert.equal(zip.headers.get('x-pdf-maker-included'), '1'); assert.equal(zip.headers.get('x-pdf-maker-excluded'), '3');
});

test('PDF-Maker reports timeouts, queue saturation, explicit deletion and automatic expiry', async (t) => {
  let release; const blocker = new Promise((resolve) => { release = resolve; });
  const { base, app, root } = await harness(t, { config: { concurrency: 1, queueLimit: 1, retentionMs: 1000 }, converter: async ({ outputDir, inputPath }) => { await blocker; const result = path.join(outputDir, `${path.basename(inputPath, '.docx')}.pdf`); await fs.writeFile(result, pdf); return result; } });
  const first = await submit(base, [['one.docx', ooxml()]]); assert.equal(first.status, 202); const accepted = await first.json();
  const saturated = await submit(base, [['two.docx', ooxml()]]); assert.equal(saturated.status, 503); assert.equal((await saturated.json()).error.code, 'QUEUE_FULL');
  release(); const done = await finished(base, accepted); assert.equal(done.status, 'succeeded');
  const removed = await fetch(`${base}/api/pdf-maker/jobs/${accepted.jobId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accepted.accessToken}` } }); assert.equal(removed.status, 204);
  assert.equal((await fetch(`${base}/api/pdf-maker/jobs/${accepted.jobId}`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } })).status, 410); await assert.rejects(fs.stat(path.join(root, accepted.jobId)));

  const secondResponse = await submit(base, [['later.docx', ooxml()]]); const second = await secondResponse.json(); await finished(base, second);
  app.locals.pdfMaker.jobs.get(second.jobId).expiresAt = Date.now() - 1; const cleanup = await app.locals.pdfMaker.cleanupExpired(); assert.deepEqual(cleanup, [true]); await assert.rejects(fs.stat(path.join(root, second.jobId)));
});

test('PDF-Maker validates OOXML, PDF-Maker environment bounds and storage isolation', async () => {
  assert.equal(inspectOoxml(ooxml('docx'), '.docx'), null); assert.equal(inspectOoxml(ooxml('pptx'), '.pptx'), null);
  assert.equal(inspectOoxml(Buffer.from('PK damaged'), '.docx').code, 'INVALID_DOCUMENT');
  assert.throws(() => loadConfig({ PORT: '6412', PDF_MAKER_CONCURRENCY: '0' }), { code: 'INVALID_ENV' });
  assert.throws(() => loadConfig({ PORT: '6412', PDF_MAKER_STORAGE_ROOT: process.cwd() }), { code: 'INVALID_ENV' });
  const valid = loadConfig({ PORT: '6412', PDF_MAKER_STORAGE_ROOT: path.join(os.tmpdir(), 'toolhub-config-test') }); assert.deepEqual(valid.pdfMaker.allowedExtensions, ['.docx', '.pptx', '.md', '.markdown']);
  assert.throws(() => loadConfig({ PORT: '6412', PDF_MAKER_STORAGE_ROOT: path.join(os.tmpdir(), 'toolhub-config-md-test'), PDF_MAKER_ALLOWED_EXTENSIONS: '.docx,.pptx' }), { code: 'INVALID_ENV' });
  assert.equal(valid.pdfMaker.engine, 'libreoffice');
  if (process.platform === 'win32') {
    assert.match(valid.pdfMaker.libreOfficePath, /soffice\.com$/i);
    assert.doesNotMatch(valid.pdfMaker.libreOfficePath, /soffice\.exe$/i);
  }
  assert.equal(loadConfig({ PORT: '6412', PDF_MAKER_STORAGE_ROOT: path.join(os.tmpdir(), 'toolhub-config-office-test'), PDF_MAKER_ENGINE: 'office' }).pdfMaker.engine, 'office');
  assert.equal(defaultLibreOfficePath({ PDF_MAKER_LIBREOFFICE_PATH: 'D:\\LibreOffice\\soffice.com' }, 'win32'), 'D:\\LibreOffice\\soffice.com');
  assert.equal(defaultLibreOfficePath({}, 'win32'), 'soffice.com');
  assert.equal(defaultLibreOfficePath({}, 'linux'), 'libreoffice');
  assert.throws(() => loadConfig({ PORT: '6412', PDF_MAKER_STORAGE_ROOT: path.join(os.tmpdir(), 'toolhub-config-engine-test'), PDF_MAKER_ENGINE: 'invalid' }), { code: 'INVALID_ENV' });
});

test('PDF-Maker keeps every LibreOffice argument path independent of storageRoot length', async (t) => {
  let invoked;
  const runtimeRoot = path.join(os.tmpdir(), 'th-pdf-rt-paths');
  const { base, root } = await harness(t, { config: { runtimeRoot }, converter: async ({ inputPath, outputDir, profileDir }) => {
    invoked = { inputPath, outputDir, profileDir };
    const result = path.join(outputDir, 'result.pdf'); await fs.mkdir(outputDir, { recursive: true }); await fs.writeFile(result, pdf); return result;
  } });
  const response = await submit(base, [['profile.docx', ooxml()]]);
  const accepted = await response.json(); const status = await finished(base, accepted);
  assert.equal(status.status, 'succeeded');
  for (const argumentPath of Object.values(invoked)) {
    assert.equal(argumentPath.startsWith(runtimeRoot + path.sep), true);
    assert.equal(argumentPath.startsWith(root + path.sep), false);
  }
  await assert.rejects(fs.stat(path.dirname(invoked.inputPath)));
});

test('PDF-Maker maps converter timeout without exposing process details', async (t) => {
  const { base } = await harness(t, { converter: async () => { throw Object.assign(new Error('command and stderr must stay private'), { code: 'CONVERSION_TIMEOUT' }); } });
  const response = await submit(base, [['slow.docx', ooxml()]]); const accepted = await response.json(); const status = await finished(base, accepted);
  assert.equal(status.status, 'failed'); assert.equal(status.files[0].error.code, 'CONVERSION_TIMEOUT'); assert.equal(JSON.stringify(status).includes('command and stderr'), false);
});
test('PDF-Maker rejects oversized requests and invalid generated PDFs', async (t) => {
  const sample = ooxml(); const fileMaxBytes = sample.length + 4096; const requestMaxBytes = fileMaxBytes + 4096;
  const { base } = await harness(t, { config: { fileMaxBytes, requestMaxBytes }, converter: async ({ outputDir }) => { const result = path.join(outputDir, 'bad.pdf'); await fs.writeFile(result, 'not pdf'); return result; } });
  const oversized = await submit(base, [['large.docx', Buffer.alloc(requestMaxBytes + 1200)]]); assert.equal(oversized.status, 413); assert.equal((await oversized.json()).error.code, 'REQUEST_TOO_LARGE');
  const response = await submit(base, [['small.docx', sample]]); const accepted = await response.json(); const status = await finished(base, accepted); assert.equal(status.status, 'failed'); assert.equal(status.files[0].error.code, 'INVALID_PDF');
});

test('PDF-Maker emits an ASCII fallback and RFC 5987 name for non-ASCII PDF downloads', async (t) => {
  const { base } = await harness(t);
  const response = await submit(base, [['보고서.docx', ooxml()]]);
  const accepted = await response.json(); const status = await finished(base, accepted);
  const download = await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}/files/${status.files[0].id}`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
  assert.equal(download.status, 200);
  const disposition = download.headers.get('content-disposition');
  assert.match(disposition, /^attachment; filename="[\x20-\x7e]+\.pdf"; filename\*=UTF-8''/);
  assert.match(disposition, /%EB%B3%B4%EA%B3%A0%EC%84%9C\.pdf$/);
});

test('PDF-Maker enforces per-file size, file count, path names, duplicate names and encrypted Office containers', async (t) => {
  const sample = ooxml(); const encrypted = encryptedOfficeContainer();
  assert.equal(inspectOoxml(encrypted, '.docx').code, 'ENCRYPTED_DOCUMENT');
  assert.equal(inspectOoxml(encrypted, '.pptx').code, 'ENCRYPTED_DOCUMENT');
  assert.equal(inspectOoxml(encryptedOfficeDifatContainer(), '.docx').code, 'ENCRYPTED_DOCUMENT');

  const { base } = await harness(t, { config: { fileMaxBytes: sample.length, maxFiles: 2 } });
  const tooLarge = await submit(base, [['large.docx', Buffer.concat([sample, Buffer.from('x')])]]);
  const tooLargeAccepted = await tooLarge.json(); const tooLargeStatus = await finished(base, tooLargeAccepted);
  assert.equal(tooLargeStatus.files[0].error.code, 'FILE_TOO_LARGE');
  const tooMany = await submit(base, [['a.docx', sample], ['b.docx', sample], ['c.docx', sample]]);
  assert.equal(tooMany.status, 413); assert.equal((await tooMany.json()).error.code, 'TOO_MANY_FILES');
  const mixed = await submit(base, [['../escape.docx', sample], ['same.docx', sample]]);
  const mixedAccepted = await mixed.json(); const mixedStatus = await finished(base, mixedAccepted);
  assert.equal(mixedStatus.files.some((file) => file.error?.code === 'UNSUPPORTED_FORMAT'), true);
});

test('PDF-Maker assigns deterministic collision-free ZIP names and handles abnormal converter exit', async (t) => {
  const { base } = await harness(t, { converter: async ({ outputDir, inputPath }) => {
    if (inputPath.endsWith('.pptx')) throw Object.assign(new Error('private abnormal exit'), { code: 'CONVERTER_FAILED' });
    const result = path.join(outputDir, 'result.pdf'); await fs.writeFile(result, pdf); return result;
  } });
  const response = await submit(base, [['same.docx', ooxml()], ['same (2).docx', ooxml()], ['same.docx', ooxml()], ['bad.pptx', ooxml('pptx')]]);
  const accepted = await response.json(); const status = await finished(base, accepted);
  assert.equal(status.status, 'partial'); assert.equal(status.files.find((file) => file.name === 'bad.pptx').error.code, 'CONVERTER_FAILED');
  const zipResponse = await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}/results.zip`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
  const archive = Buffer.from(await zipResponse.arrayBuffer()); const names = [];
  for (let index = 0; index + 46 <= archive.length; index += 1) {
    if (archive.readUInt32LE(index) !== 0x02014b50) continue;
    const length = archive.readUInt16LE(index + 28); names.push(archive.subarray(index + 46, index + 46 + length).toString());
  }
  assert.deepEqual(names, ['same.pdf', 'same (2).pdf', 'same (3).pdf']);
});

test('PDF-Maker rejects a staging link redirected outside the trusted job root', async (t) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'toolhub-pdf-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const { base } = await harness(t, { converter: async ({ outputDir }) => {
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.symlink(outside, outputDir, process.platform === 'win32' ? 'junction' : 'dir');
    const result = path.join(outputDir, 'escaped.pdf'); await fs.writeFile(result, pdf); return result;
  } });
  const response = await submit(base, [['linked.docx', ooxml()]]); const accepted = await response.json(); const status = await finished(base, accepted);
  assert.equal(status.status, 'failed'); assert.equal(status.files[0].error.code, 'INVALID_PDF');
  assert.deepEqual(await fs.readFile(path.join(outside, 'escaped.pdf')), pdf);
});

test('Office converter invokes hidden PowerShell COM automation with Unicode-safe paths', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toolhub-pdf-office-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, '職務経歴書.docx'); const outputDir = path.join(root, 'out');
  await fs.writeFile(inputPath, realDocx());
  let invocation;
  const result = await officeConverter({
    inputPath, outputDir, timeoutMs: 1000, executable: 'powershell.exe',
    spawnImpl(executable, args, options) {
      invocation = { executable, args, options };
      const child = new EventEmitter(); child.pid = 12345; queueMicrotask(() => child.emit('exit', 0)); return child;
    }
  });
  assert.equal(invocation.executable, 'powershell.exe');
  assert.deepEqual(invocation.args.slice(0, 3), ['-NoLogo', '-NoProfile', '-NonInteractive']);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.PDF_MAKER_INPUT, path.resolve(inputPath));
  assert.equal(invocation.options.env.PDF_MAKER_OUTPUT, path.resolve(result));
  const script = Buffer.from(invocation.args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /Word\.Application/);
  assert.match(script, /PowerPoint\.Application/);
  assert.equal(script.match(/\$app\.AutomationSecurity = 3/g)?.length, 2);
  assert.match(script, /ExportAsFixedFormat/);
  assert.match(script, /\$missing = \[Type\]::Missing/);
  assert.match(script, /Documents\.Open\([^\r\n]+\$false, \$true, \$missing, \$true\)/);
});

test('LibreOffice timeout kills a real process tree and reports no staged output', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toolhub-pdf-timeout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'input.docx'); const outputDir = path.join(root, 'output'); const profileDir = path.join(root, 'profile'); const pidFile = path.join(root, 'pids');
  await fs.writeFile(inputPath, ooxml());
  const script = "const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],process.pid+','+c.pid);setInterval(()=>{},1000)";
  const began = Date.now();
  await assert.rejects(libreOfficeConverter({
    inputPath, outputDir, profileDir, timeoutMs: 200,
    spawnImpl() { return spawn(process.execPath, ['-e', script, pidFile], { windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore' }); }
  }), { code: 'CONVERSION_TIMEOUT' });
  assert.ok(Date.now() - began < 3000); assert.deepEqual(await fs.readdir(outputDir), []);
  const pids = (await fs.readFile(pidFile, 'utf8')).split(',').map(Number);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let attempt = 0; attempt < 50 && pids.some(alive); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(pids.map(alive), [false, false]);
});

test('LibreOffice timeout completes finitely even when termination does not settle', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toolhub-pdf-timeout-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'input.docx'); const outputDir = path.join(root, 'output'); const profileDir = path.join(root, 'profile');
  await fs.writeFile(inputPath, ooxml());
  const child = new EventEmitter(); child.pid = 4242; const began = Date.now();
  await assert.rejects(libreOfficeConverter({
    inputPath, outputDir, profileDir, timeoutMs: 5, spawnImpl() { return child; }, killImpl() { return new Promise(() => {}); }
  }), { code: 'CONVERSION_TIMEOUT' });
  assert.ok(Date.now() - began < 3000);
});

test('LibreOffice headless conversion accepts the representative Word and PowerPoint fixtures when LibreOffice is installed', async (t) => {
  const executable = findLibreOfficeExecutable();
  if (!executable) {
    t.skip(`no LibreOffice headless binary found at the configured runtime path: ${defaultLibreOfficePath()}`);
    return;
  }
  for (const [name, data] of [['report.docx', realDocx()], ['slides.pptx', realPptx()]]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toolhub-pdf-libreoffice-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const inputPath = path.join(root, name); await fs.writeFile(inputPath, data);
    const outputDir = path.join(root, 'output'); const profileDir = path.join(root, 'profile');
    const resultPath = await libreOfficeConverter({ inputPath, outputDir, profileDir, timeoutMs: 60000, executable });
    const produced = await fs.readFile(resultPath);
    assert.equal(produced.subarray(0, 5).toString(), '%PDF-');
    assert.ok(produced.includes(Buffer.from('%%EOF')));
  }
});

test('LibreOffice API conversion succeeds repeatedly with a deployment-length storageRoot', async (t) => {
  const executable = findLibreOfficeExecutable();
  if (!executable) { t.skip('LibreOffice is not installed'); return; }
  const longRoot = path.join(os.tmpdir(), `flowgate-storage-${'x'.repeat(150)}`);
  const runtimeRoot = loadConfig({ PORT: '6412', PDF_MAKER_STORAGE_ROOT: longRoot }).pdfMaker.runtimeRoot;
  const app = createApp({ logger: { info() {}, warn() {} }, pdfMakerConfig: configFor(longRoot, { runtimeRoot, libreOfficePath: executable, timeoutMs: 60000 }) });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.close(); await app.locals.pdfMaker.close(); await fs.rm(longRoot, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await submit(base, [[`long-${attempt}.docx`, realDocx()]]);
    assert.equal(response.status, 202);
    const accepted = await response.json(); const status = await finished(base, accepted, 1000);
    assert.equal(status.status, 'succeeded');
    const download = await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}/files/${status.files[0].id}`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
    const produced = Buffer.from(await download.arrayBuffer());
    assert.equal(download.status, 200); assert.equal(produced.subarray(0, 5).toString(), '%PDF-'); assert.ok(produced.includes(Buffer.from('%%EOF')));
  }
});

test('PDF-Maker retries failed cleanup, makes repeated cleanup idempotent, and logs correlation identifiers and safe classifications without secrets', async (t) => {
  const logs = []; let removalAttempts = 0;
  const logger = { info(value) { logs.push(value); }, warn(value) { logs.push(value); } };
  let failedRoot;
  const removePath = async (target, options) => {
    removalAttempts += 1;
    if (target === failedRoot && removalAttempts === 1) throw new Error('private cleanup path');
    return fs.rm(target, options);
  };
  const { base, app } = await harness(t, {
    logger, removePath,
    converter: async () => { throw new Error('secret stderr and command'); }
  });
  const response = await submit(base, [['secret-customer-name.docx', ooxml()]]);
  const accepted = await response.json(); const status = await finished(base, accepted);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const job = app.locals.pdfMaker.jobs.get(accepted.jobId); failedRoot = job.root; removalAttempts = 0; job.expiresAt = Date.now() - 1;
  assert.deepEqual(await app.locals.pdfMaker.cleanupExpired(), [false]);
  assert.deepEqual(await app.locals.pdfMaker.cleanupExpired(), [true]);
  assert.deepEqual(await app.locals.pdfMaker.cleanupExpired(), []);
  const serialized = logs.join('\n');
  assert.equal(serialized.includes('secret-customer-name'), false);
  assert.equal(serialized.includes('secret stderr'), false);
  assert.equal(serialized.includes(accepted.accessToken), false);

  const fileId = status.files[0].id;
  const entries = logs.map((value) => JSON.parse(value));
  assert.ok(entries.some((entry) => entry.event === 'pdf_maker_accepted' && entry.requestId && /^[A-Za-z0-9_-]+$/.test(entry.requestId) && entry.jobId === accepted.jobId));
  assert.ok(entries.some((entry) => entry.event === 'pdf_maker_state' && entry.jobId === accepted.jobId && entry.fileId === fileId && entry.to === 'converting'));
  assert.ok(entries.some((entry) => entry.event === 'pdf_maker_state' && entry.jobId === accepted.jobId && entry.fileId === fileId && entry.from === 'converting' && entry.to === 'failed'));
  assert.ok(entries.some((entry) => entry.event === 'pdf_maker_conversion' && entry.jobId === accepted.jobId && entry.fileId === fileId && entry.status === 'failed' && entry.errorCode === 'CONVERTER_FAILED'));
  assert.ok(entries.some((entry) => entry.event === 'pdf_maker_cleanup' && entry.jobId === accepted.jobId && entry.removed === false));
  assert.ok(entries.some((entry) => entry.event === 'pdf_maker_cleanup' && entry.jobId === accepted.jobId && entry.removed === true));
});


test('PDF-Maker validates UTF-8 Markdown uploads and rejects NUL bytes, malformed UTF-8, and binary files masquerading as Markdown', async (t) => {
  const validMarkdown = Buffer.from('# Title\n\nSome **markdown** body with a list:\n\n- one\n- two\n', 'utf8');
  const nulByteMarkdown = Buffer.from('before\x00after', 'utf8');
  const malformedUtf8 = Buffer.from([0x66, 0x6f, 0x6f, 0xc3, 0x28]);
  assert.equal(inspectMarkdown(validMarkdown), null);
  assert.equal(inspectMarkdown(nulByteMarkdown).code, 'INVALID_DOCUMENT');
  assert.equal(inspectMarkdown(malformedUtf8).code, 'INVALID_DOCUMENT');
  assert.equal(inspectMarkdown(ooxml('docx')).code, 'INVALID_DOCUMENT');
  assert.equal(inspectMarkdown(encryptedOfficeContainer()).code, 'INVALID_DOCUMENT');
  assert.equal(inspectMarkdown(pdf).code, 'INVALID_DOCUMENT');

  const { base } = await harness(t, { markdownConverter: async ({ outputDir }) => { const result = path.join(outputDir, 'note.pdf'); await fs.writeFile(result, pdf); return result; } });
  const response = await submit(base, [
    ['note.md', validMarkdown],
    ['disguised.md', ooxml('docx')],
    ['broken.markdown', malformedUtf8]
  ]);
  assert.equal(response.status, 202);
  const accepted = await response.json();
  const status = await finished(base, accepted);
  assert.equal(status.status, 'partial');
  assert.equal(status.files.find((file) => file.name === 'note.md').status, 'succeeded');
  assert.equal(status.files.find((file) => file.name === 'disguised.md').error.code, 'INVALID_DOCUMENT');
  assert.equal(status.files.find((file) => file.name === 'broken.markdown').error.code, 'INVALID_DOCUMENT');
});

test('PDF-Maker never routes Markdown through Office COM automation, even when PDF_MAKER_ENGINE=office', async (t) => {
  let officeInvoked = false; let markdownInvoked = false;
  const officeStub = async () => { officeInvoked = true; throw Object.assign(new Error('office converter must not run for markdown'), { code: 'CONVERTER_FAILED' }); };
  const markdownStub = async ({ outputDir, inputPath }) => {
    markdownInvoked = true;
    assert.match(inputPath, /i\.html$/);
    const html = await fs.readFile(inputPath, 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Content-Security-Policy/i);
    const result = path.join(outputDir, 'md.pdf'); await fs.writeFile(result, pdf); return result;
  };
  const { base } = await harness(t, { config: { engine: 'office' }, converter: officeStub, markdownConverter: markdownStub });
  const response = await submit(base, [['note.md', Buffer.from('# Heading\n\nBody text.\n', 'utf8')]]);
  assert.equal(response.status, 202);
  const accepted = await response.json();
  const status = await finished(base, accepted);
  assert.equal(status.status, 'succeeded');
  assert.equal(markdownInvoked, true);
  assert.equal(officeInvoked, false);
});

test('PDF-Maker enforces the concurrency queue on the Markdown conversion path', async (t) => {
  let release; const blocker = new Promise((resolve) => { release = resolve; });
  const { base } = await harness(t, { config: { concurrency: 1, queueLimit: 1 }, markdownConverter: async ({ outputDir }) => { await blocker; const result = path.join(outputDir, 'note.pdf'); await fs.writeFile(result, pdf); return result; } });
  const first = await submit(base, [['first.md', Buffer.from('# One\n', 'utf8')]]);
  assert.equal(first.status, 202); const accepted = await first.json();
  const saturated = await submit(base, [['second.md', Buffer.from('# Two\n', 'utf8')]]);
  assert.equal(saturated.status, 503); assert.equal((await saturated.json()).error.code, 'QUEUE_FULL');
  release(); const done = await finished(base, accepted); assert.equal(done.status, 'succeeded');
});

test('PDF-Maker maps a Markdown converter timeout to CONVERSION_TIMEOUT without exposing internals', async (t) => {
  const { base } = await harness(t, { markdownConverter: async () => { throw Object.assign(new Error('secret libreoffice command and stderr'), { code: 'CONVERSION_TIMEOUT' }); } });
  const response = await submit(base, [['slow.md', Buffer.from('# Slow\n', 'utf8')]]);
  const accepted = await response.json(); const status = await finished(base, accepted);
  assert.equal(status.status, 'failed'); assert.equal(status.files[0].error.code, 'CONVERSION_TIMEOUT');
  assert.equal(JSON.stringify(status).includes('secret libreoffice command'), false);
});

test('LibreOffice timeout kills a real process tree on the Markdown job path', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toolhub-pdf-md-timeout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pidFile = path.join(root, 'pids');
  const script = "const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],process.pid+','+c.pid);setInterval(()=>{},1000)";
  const { base } = await harness(t, {
    config: { timeoutMs: 200 },
    markdownConverter: (args) => libreOfficeConverter({ ...args, spawnImpl: () => spawn(process.execPath, ['-e', script, pidFile], { windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore' }) })
  });
  const response = await submit(base, [['stuck.md', Buffer.from('# Stuck\n', 'utf8')]]);
  const accepted = await response.json();
  const status = await finished(base, accepted, 400);
  assert.equal(status.status, 'failed'); assert.equal(status.files[0].error.code, 'CONVERSION_TIMEOUT');
  const pids = (await fs.readFile(pidFile, 'utf8')).split(',').map(Number);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let attempt = 0; attempt < 50 && pids.some(alive); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(pids.map(alive), [false, false]);
});

test('LibreOffice headless conversion produces a valid PDF from a Markdown fixture with Korean text, headings, lists, blockquote, a table, and a fenced code block', async (t) => {
  const executable = findLibreOfficeExecutable();
  if (!executable) {
    t.skip(`no LibreOffice headless binary found at the configured runtime path: ${defaultLibreOfficePath()}`);
    return;
  }
  const markdown = [
    '# 제목 1',
    '',
    '## 제목 2',
    '',
    '한글 본문 텍스트입니다. PDF-Maker의 Markdown 변환 경로를 검증합니다.',
    '',
    '- 비순서 항목 1',
    '- 비순서 항목 2',
    '',
    '1. 순서 항목 1',
    '2. 순서 항목 2',
    '',
    '> 인용문 블록입니다.',
    '',
    '| 열1 | 열2 |',
    '| --- | --- |',
    '| 값1 | 값2 |',
    '',
    '```javascript',
    'const answer = 42;',
    '```',
    ''
  ].join('\n');
  const { base } = await harness(t, { config: { libreOfficePath: executable, timeoutMs: 60000 } });
  const response = await submit(base, [['korean-notes.md', Buffer.from(markdown, 'utf8')]]);
  assert.equal(response.status, 202);
  const accepted = await response.json();
  const status = await finished(base, accepted, 1000);
  assert.equal(status.status, 'succeeded');
  const download = await fetch(`${base}/api/pdf-maker/jobs/${status.jobId}/files/${status.files[0].id}`, { headers: { Authorization: `Bearer ${accepted.accessToken}` } });
  const produced = Buffer.from(await download.arrayBuffer());
  assert.equal(download.status, 200);
  assert.equal(produced.subarray(0, 5).toString(), '%PDF-');
  assert.ok(produced.includes(Buffer.from('%%EOF')));
});
