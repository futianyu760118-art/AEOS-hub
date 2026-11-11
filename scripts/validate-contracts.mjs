import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const fail = (message) => { console.error(`[contracts] ${message}`); process.exit(1); };

const openapi = read('contracts/openapi.json');
if (openapi.openapi !== '3.0.3') fail('openapi.json version must be 3.0.3');
for (const path of [
  '/api/tasks', '/api/tasks/{taskId}', '/api/tasks/{taskId}/assignments',
  '/api/tasks/{taskId}/results/{resultId}/verify', '/api/evidence', '/healthz',
]) {
  if (!openapi.paths?.[path]) fail(`openapi.json missing path ${path}`);
}
for (const file of [
  'contracts/task/task.schema.json',
  'contracts/task/assignment.schema.json',
  'contracts/task/task-update.schema.json',
  'contracts/task/task-result.schema.json',
  'contracts/task/verify.schema.json',
]) {
  const schema = read(file);
  if (schema.type !== 'object') fail(`${file} must describe an object`);
}
console.log('[contracts] OK: OpenAPI and task schemas parse and expose the required endpoints.');
