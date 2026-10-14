import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

test('renders escaped Agent run output from task detail and project workspace through one renderer', () => {
  assert.match(app, /function renderAgentRunResult\(agentRun, compact = false\)/);
  assert.match(app, /esc\(agentRunOutputText\(execution\.result\)\)/);
  assert.match(app, /renderAgentRunResult\(details\.task\?\.agentRun\)/);
  assert.match(app, /renderAgentRunResult\(task\.agentRun, true\)/);
  assert.match(app, /loadProjectTaskDetails\(projectId\)/);
  assert.match(app, /data-task-action="project-link"/);
  assert.match(app, /data-task-project-link-form/);
  assert.match(app, /查看运行与历史/);
  assert.match(app, /\/api\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/project/);
});

test('styles a compact project result panel and an expandable task result panel', () => {
  assert.match(css, /\.agent-run-result \{/);
  assert.match(css, /\.agent-run-result\.compact/);
  assert.match(css, /\.agent-run-result-body pre/);
});
