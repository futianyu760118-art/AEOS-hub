// demo-ERP：AEOS 中枢可调用的第一个"业务系统能力"演示 MCP server（只读）
// 用途：验证 中枢Agent → MCP → 业务系统 链路；数据为本地演示数据，不含真实业务。
// 运行：node mcp/demo-erp.mjs（stdio 传输，由 codex 作为 MCP 客户端拉起）
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'demo-erp', version: '0.1.0' });

// ---------- 演示数据（字段风格对齐 AEOS Result/Evidence 契约） ----------
const ORDERS = [
  { order_no: 'SO-2609-001', customer: '欧莱雅照明(示例)', product_line: '商业照明', amount_cny: 1280000, due_date: '2026-09-20', risk_level: '高', risk_probability: 0.72, risk_type: '关键物料缺料', blocking_reason: '驱动电源 MO-8821 采购在途未到', evidence_ref: 'demo_erp://so/SO-2609-001@2026-09-03' },
  { order_no: 'SO-2609-002', customer: '华泰工程(示例)', product_line: '户外照明', amount_cny: 560000, due_date: '2026-09-28', risk_level: '中', risk_probability: 0.45, risk_type: '产能瓶颈', blocking_reason: '压铸车间 9 月 3 周产能利用率预计 96%', evidence_ref: 'demo_erp://so/SO-2609-002@2026-09-03' },
  { order_no: 'SO-2610-003', customer: '新域零售(示例)', product_line: '家居照明', amount_cny: 780000, due_date: '2026-10-15', risk_level: '低', risk_probability: 0.2, risk_type: '', blocking_reason: null, evidence_ref: 'demo_erp://so/SO-2610-003@2026-09-03' },
  { order_no: 'SO-2610-004', customer: '科达建工(示例)', product_line: '工程照明', amount_cny: 2100000, due_date: '2026-10-05', risk_level: '高', risk_probability: 0.8, risk_type: '图纸冻结延迟', blocking_reason: '结构图纸 ECN-445 评审未关闭，影响投料', evidence_ref: 'demo_erp://so/SO-2610-004@2026-09-03' },
  { order_no: 'SO-2609-005', customer: '广达商业(示例)', product_line: '商业照明', amount_cny: 430000, due_date: '2026-09-25', risk_level: '中', risk_probability: 0.5, risk_type: '质量放行待确认', blocking_reason: '首批样品可靠性测试待品质确认', evidence_ref: 'demo_erp://so/SO-2609-005@2026-09-03' },
];

const MATERIALS = [
  { material_code: 'MO-8821', name: 'LED 驱动电源 60W(示例)', shortage_qty: 3200, expected_in_date: '2026-09-12', gap_days: 8, risk_probability: 0.72, affected_orders: ['SO-2609-001'], evidence_ref: 'demo_erp://po/MO-8821@2026-09-03' },
  { material_code: 'MS-3310', name: '铝合金压铸件-灯壳(示例)', shortage_qty: 1500, expected_in_date: '2026-09-08', gap_days: 4, risk_probability: 0.45, affected_orders: ['SO-2609-002'], evidence_ref: 'demo_erp://po/MS-3310@2026-09-03' },
  { material_code: 'OP-7702', name: '光学透镜 PC(示例)', shortage_qty: 0, expected_in_date: null, gap_days: 0, risk_probability: 0.05, affected_orders: [], evidence_ref: 'demo_erp://po/OP-7702@2026-09-03' },
];

server.registerTool(
  'list_order_risks',
  {
    title: '扫描订单风险（只读）',
    description: '扫描未来窗口内存在交付风险的关键订单。只读工具，输出含 evidence_refs。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      window_days: z.number().int().min(1).max(180).default(60).describe('未来天数窗口'),
      min_probability: z.number().min(0).max(1).default(0).describe('最低风险概率过滤'),
    },
  },
  async ({ window_days, min_probability }) => {
    const rows = ORDERS.filter((o) => o.risk_probability >= min_probability).map((o) => ({ ...o }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ source: 'demo-erp', read_only: true, generated_at: '2026-09-03T08:00:00Z', window_days, count: rows.length, orders: rows }, null, 2) }],
    };
  },
);

server.registerTool(
  'check_material_shortages',
  {
    title: '检查物料供应缺口（只读）',
    description: '按物料编码检查供应缺口；不传编码则返回全部有缺口的物料。只读工具，输出含 evidence_refs。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      material_code: z.string().optional().describe('物料编码，如 MO-8821'),
    },
  },
  async ({ material_code }) => {
    const rows = MATERIALS.filter((m) => (material_code ? m.material_code === material_code : m.shortage_qty > 0)).map((m) => ({ ...m }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ source: 'demo-erp', read_only: true, generated_at: '2026-09-03T08:00:00Z', count: rows.length, shortages: rows }, null, 2) }],
    };
  },
);

server.registerTool(
  'get_system_health',
  {
    title: '连接自检（只读）',
    description: '返回 demo-ERP 能力状态，用于验证 中枢Agent→MCP 链路连通性。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  },
  async () => {
    return {
      content: [{ type: 'text', text: JSON.stringify({ source: 'demo-erp', status: 'ok', read_only: true, capabilities: ['list_order_risks', 'check_material_shortages', 'get_system_health'], version: '0.1.0' }, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
