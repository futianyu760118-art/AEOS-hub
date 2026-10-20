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
  assert.match(html, /id="harbor-agent-domain-filter"[\s\S]*订单交付[\s\S]*物料齐套[\s\S]*异常与质量[\s\S]*生产协同[\s\S]*跨域\/中枢/);
  assert.match(html, /data-catalog-view="ownership"[\s\S]*data-catalog-view="hierarchy"/);
  assert.match(html, /id="harbor-agent-list" class="catalog-tree"/);
  assert.match(html, /id="catalog-summary"/);

  assert.match(app, /fetch\('\/api\/catalog\/tree'/);
  assert.match(app, /function renderCatalogSystem\(/);
  assert.match(app, /function renderCatalogDomain\(/);
  assert.match(app, /function renderCatalogAgentRow\(/);
  assert.match(app, /function renderCatalogHierarchyView\(/);
  assert.match(app, /data-catalog-system-toggle="/);
  assert.match(app, /data-catalog-domain-toggle="/);
  assert.match(app, /agent\.domainIds \|\| \[\]\)\.includes\(harborAgentFilter\.domain\)/);
  assert.match(app, /未登记港湾/);
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
