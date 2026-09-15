import sampleTool from './sample-tool/index.js';
import randomNumberTool from './random-number/index.js';

export const registrations = [
  { id: 'sample-tool', name: 'Sample Tool', description: 'A read-only ToolHub extension example.', tags: ['sample', 'read-only'], active: true, module: sampleTool },
  { id: 'random-number', name: 'Random Number', description: 'Generate random integers inside a selected range.', tags: ['random', 'number', 'utility'], active: true, module: randomNumberTool }
];
export const toolIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function validateRegistry(items = registrations) {
  const seen = new Set();
  for (const item of items) {
    if (!item || !toolIdPattern.test(item.id || '')) throw Object.assign(new Error('invalid tool id: ' + (item?.id || '<missing>')), { code: 'TOOL_REGISTRATION' });
    if (!item.name || !item.description || !Array.isArray(item.tags) || typeof item.active !== 'boolean' || typeof item.module?.render !== 'function') throw Object.assign(new Error('missing metadata or entrypoint: ' + item.id), { code: 'TOOL_REGISTRATION' });
    if (seen.has(item.id)) throw Object.assign(new Error('duplicate tool id: ' + item.id), { code: 'TOOL_REGISTRATION' });
    seen.add(item.id);
  }
  return items.filter((item) => item.active);
}