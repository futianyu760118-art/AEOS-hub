import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('keeps Task Center as a visible standalone navigation entry without restoring retired case and inbox links', () => {
  const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

  assert.match(html, /id="task-center-nav"[\s\S]*data-view="tasks"/);
  assert.doesNotMatch(html, /data-view="cases"/);
  assert.doesNotMatch(html, /data-view="inbox"/);
  assert.doesNotMatch(css, /#task-center-nav\s*,?[\s\S]{0,80}display:\s*none/);
});
