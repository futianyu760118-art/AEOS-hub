import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { localizeUiText } from '../public/ui-localization.js';

const root = process.cwd();

test('translates platform presentation vocabulary without changing protocol identifiers', () => {
  assert.equal(localizeUiText('Capability Registry / Agent / Runtime'), '能力注册表 / 智能体 / 运行时');
  assert.equal(localizeUiText('healthy', { exactOnly: true }), '健康');
  assert.equal(localizeUiText('api endpoint not found'), '接口未找到');
  assert.equal(localizeUiText('IN_PROGRESS', { exactOnly: true }), 'IN_PROGRESS');
  assert.equal(localizeUiText('hub://collaboration/projects/p-1', { exactOnly: true }), 'hub://collaboration/projects/p-1');
});

test('loads the Chinese localization layer before rendering the workspace', () => {
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
  const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  assert.match(app, /localizeStaticDocument\(\);\s*refreshIcons\(\);/);
  assert.match(app, /localizeDynamicCopy\(root\)/);
  assert.equal(localizeUiText('中枢 Agent 与 Guard'), '中枢智能体 与 治理门禁');
  assert.match(html, /app\.js\?v=ui-zh-cn-20261013/);
});
