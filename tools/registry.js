import sampleTool from './sample-tool/index.js';
import randomNumberTool from './random-number/index.js';
import pdfMakerTool from './pdf-maker/index.js';
import mdViewerTool from './md-viewer/index.js';

export const DEFAULT_GROUP = 'Tools';

export const registrations = [
  { id: 'sample-tool', name: 'Sample Tool', description: 'A read-only ToolHub extension example.', tags: ['sample', 'read-only'], group: 'Sample', icon: '≡', active: true, module: sampleTool },
  { id: 'random-number', name: 'Random Number', description: 'Generate random integers inside a selected range.', tags: ['random', 'number', 'utility'], group: 'Utility', icon: '#', active: true, module: randomNumberTool },
  { id: 'pdf-maker', name: 'PDF-Maker', description: 'Convert Word and PowerPoint documents to downloadable PDFs.', tags: ['pdf', 'document', 'converter'], group: 'Document', icon: 'P', active: true, module: pdfMakerTool },
  { id: 'md-viewer', name: 'MD Viewer', description: 'Preview Markdown files locally in your browser without uploading them.', tags: ['markdown', 'viewer', 'document'], group: 'Document', icon: 'MD', active: true, module: mdViewerTool }
];
export const toolIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function validateRegistry(items = registrations) {
  const seen = new Set();
  for (const item of items) {
    if (!item || !toolIdPattern.test(item.id || '')) throw Object.assign(new Error('invalid tool id: ' + (item?.id || '<missing>')), { code: 'TOOL_REGISTRATION' });
    if (!item.name || !item.description || !Array.isArray(item.tags) || typeof item.active !== 'boolean' || typeof item.module?.render !== 'function') throw Object.assign(new Error('missing metadata or entrypoint: ' + item.id), { code: 'TOOL_REGISTRATION' });
    if (item.group !== undefined && (typeof item.group !== 'string' || item.group.trim() === '')) throw Object.assign(new Error('invalid rail group: ' + item.id), { code: 'TOOL_REGISTRATION' });
    if (item.icon !== undefined && (typeof item.icon !== 'string' || item.icon.length < 1 || item.icon.length > 2)) throw Object.assign(new Error('invalid rail icon: ' + item.id), { code: 'TOOL_REGISTRATION' });
    if (seen.has(item.id)) throw Object.assign(new Error('duplicate tool id: ' + item.id), { code: 'TOOL_REGISTRATION' });
    seen.add(item.id);
  }
  return items.filter((item) => item.active);
}

export const toolGroup = (tool) => (tool.group || DEFAULT_GROUP).trim();
export const toolIcon = (tool) => tool.icon || tool.name.trim().charAt(0).toUpperCase();

export function groupTools(tools) {
  const groups = new Map();
  for (const tool of tools) {
    const name = toolGroup(tool);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(tool);
  }
  return [...groups]
    .map(([group, items]) => ({ group, items: items.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

export function tagCounts(tools) {
  const counts = new Map();
  for (const tool of tools) for (const tag of tool.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

export function closestToolId(value, tools) {
  const target = String(value ?? '').toLowerCase();
  if (!target || target.length > 64) return null;
  let best = null;
  for (const tool of tools) {
    const distance = editDistance(target, tool.id);
    const budget = Math.max(1, Math.floor(tool.id.length / 3));
    if (distance > 0 && distance <= budget && (!best || distance < best.distance)) best = { tool, distance };
  }
  return best?.tool ?? null;
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}
