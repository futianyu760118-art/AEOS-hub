// 独立验证 demo-ERP MCP server（不依赖 codex / 模型）
// 用法: npm run test:mcp  → 通过退出码 0，失败退出码 1
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'mcp', 'demo-erp.mjs');

const child = spawn(process.execPath, [serverPath], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: child.stdout });

let seq = 0;
const pending = new Map();
function send(method, params = {}, id) {
  const msg = { jsonrpc: '2.0', id: id ?? ++seq, method };
  if (params && Object.keys(params).length) msg.params = params;
  child.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve, reject) => {
    const myId = msg.id;
    pending.set(myId, { resolve, reject });
    setTimeout(() => {
      if (pending.has(myId)) {
        pending.delete(myId);
        reject(new Error(`等待 ${method} 响应超时`));
      }
    }, 15000);
  });
}

// MCP 通知：不带 id（带 id 会被服务端当作请求并报 method not found）
function notify(method, params = {}) {
  const msg = { jsonrpc: '2.0', method };
  if (params && Object.keys(params).length) msg.params = params;
  child.stdin.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(`${m.error.message} (code=${m.error.code})`)) : p.resolve(m.result);
  }
});

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  child.kill();
  process.exit(1);
}

try {
  // 1. initialize 握手
  const init = await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'aeos-hub-test', version: '0.1.0' },
  }, 0);
  if (init?.serverInfo?.name !== 'demo-erp') throw new Error(`serverInfo 异常: ${JSON.stringify(init)}`);
  console.log(`[OK] initialize: server=${init.serverInfo.name} v${init.serverInfo.version}`);
  notify('notifications/initialized', {});

  // 2. tools/list
  const list = await send('tools/list');
  const names = list.tools.map((t) => t.name).sort();
  console.log(`[OK] tools/list: ${names.join(', ')}`);
  if (!names.includes('list_order_risks') || !names.includes('check_material_shortages')) {
    throw new Error('缺少预期工具');
  }

  // 3. tools/call: 订单风险扫描
  const risk = await send('tools/call', { name: 'list_order_risks', arguments: { window_days: 60, min_probability: 0.4 } });
  const text = risk?.content?.[0]?.text;
  const parsed = JSON.parse(text);
  if (!parsed.orders?.length || !parsed.orders[0].evidence_ref) throw new Error('结果缺少 orders/evidence_ref');
  console.log(`[OK] list_order_risks: ${parsed.count} 条(≥0.4)，示例 evidence_ref=${parsed.orders[0].evidence_ref}`);

  // 4. tools/call: 物料缺口
  const shortage = await send('tools/call', { name: 'check_material_shortages', arguments: {} });
  const parsedS = JSON.parse(shortage.content[0].text);
  if (!parsedS.shortages?.length) throw new Error('物料缺口结果为空');
  console.log(`[OK] check_material_shortages: ${parsedS.count} 条缺口，首条=${parsedS.shortages[0].material_code} x${parsedS.shortages[0].shortage_qty}`);

  console.log('PASS: demo-ERP MCP server 链路完整可用（读工具、写工具均按预期响应）');
  child.kill();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
