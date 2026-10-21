import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('AI 港湾智能体目录提供三级树、业务域筛选与两种视图', () => {
  const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
  const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

  assert.match(html, /id="harbor-panel-agents"[\s\S]*统一智能体目录/);
  assert.match(html, /id="harbor-agent-domain-filter"[\s\S]*<option value="all">全部业务域<\/option>[\s\S]*订单交付[\s\S]*物料齐套[\s\S]*质量异常[\s\S]*生产进度[\s\S]*跨系统协同/);
  assert.match(html, /class="catalog-domain-help"[\s\S]*订单风险、交期、客户承诺[\s\S]*缺料、库存、供给[\s\S]*来料、制程、客诉[\s\S]*工单、工序、报工[\s\S]*跨系统共享能力/);
  assert.match(html, /data-catalog-view="ownership"[\s\S]*data-catalog-view="hierarchy"/);
  assert.match(html, /id="harbor-agent-list" class="catalog-tree"/);
  assert.match(html, /id="catalog-summary"/);
  assert.doesNotMatch(html, /harbor-show-archived/);

  assert.match(app, /fetch\('\/api\/catalog\/tree'/);
  assert.match(app, /function renderCatalogSystem\(/);
  assert.match(app, /function renderCatalogDomain\(/);
  assert.match(app, /function renderCatalogAgentRow\(/);
  assert.match(app, /function renderCatalogHierarchyView\(/);
  assert.match(app, /data-catalog-system-toggle="/);
  assert.match(app, /data-catalog-domain-toggle="/);
  assert.match(app, /includes\(harborAgentFilter\.domain\)/);
  assert.match(app, /harborAgentFilter\.domain = els\.harborAgentDomainFilter\.value/);
  assert.doesNotMatch(app, /data-catalog-domain-filter/);
  assert.match(css, /\.catalog-domain-help/);
  assert.match(app, /未登记港湾/);
  assert.doesNotMatch(app, /catalogShowArchived/);
  assert.doesNotMatch(app, /agent\.lifecycle === 'retired' \|\| agent\.status === 'archived'/);
  assert.match(app, /function catalogUsageHtml\(/);
  assert.match(app, /function catalogAgentUsageDetail\(/);
  assert.match(app, /data-open-usage-detail/);
  assert.match(app, /Token 未上报/);
  assert.match(app, /无模型 Token/);
  assert.match(app, /查询接口不产生模型 Token/);
  assert.match(app, /function agentExpectsModelUsage/);
  assert.match(css, /\.catalog-agent-detail\s*\{/);
  assert.match(css, /\.catalog-usage-cards\s*\{/);
  assert.match(app, /name="systemId"/);
  assert.match(app, /name="primaryDomainId"/);
  assert.match(app, /name="domainIds"/);

  assert.match(css, /\.catalog-system\.is-expanded > \.catalog-system-body\s*\{\s*display:\s*flex/);
  assert.match(css, /\.catalog-domain\.is-expanded > \.catalog-domain-body\s*\{\s*display:\s*block/);
  assert.match(css, /\.catalog-agent-row\s*\{/);
});

test('智能体目录不再依赖小队筛选或加入小队入口', () => {
  const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');

  assert.doesNotMatch(html, /harbor-agent-squad-filter/);
  assert.doesNotMatch(app, /harborAgentSquadFilter/);
  assert.doesNotMatch(app, /harbor-add-to-squad/);
});
