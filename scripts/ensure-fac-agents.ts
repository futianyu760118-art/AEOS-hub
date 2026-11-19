import { createHarborAgent, loadHarbor } from '../src/harbor-store.ts';

const FINANCE_AGENTS = [
  { id: 'AG-FAC-001', name: '财务总监智能体', role: '综合财经', skills: ['finance_review_pack', 'finance_opportunity'], autonomy: 'A1' },
  { id: 'AG-FAC-002', name: '收入智能体', role: '收入', skills: ['revenue_variance'], autonomy: 'A1' },
  { id: 'AG-FAC-003', name: '成本智能体', role: '成本', skills: ['quote_cost_calc', 'quote_actual_variance'], autonomy: 'A2' },
  { id: 'AG-FAC-004', name: '毛利智能体', role: '毛利', skills: ['order_margin_calc', 'order_economic_assessment'], autonomy: 'A2' },
  { id: 'AG-FAC-005', name: '应收智能体', role: '应收', skills: ['ar_aging', 'dso_calc'], autonomy: 'A2' },
  { id: 'AG-FAC-006', name: '资金智能体', role: '资金', skills: ['cash_7_30_90'], autonomy: 'A2' },
  { id: 'AG-FAC-007', name: '预算智能体', role: '预算', skills: ['budget_actual_variance'], autonomy: 'A1' },
  { id: 'AG-FAC-008', name: 'ROI智能体', role: '投入产出', skills: ['project_roi'], autonomy: 'A1' },
  { id: 'AG-FAC-009', name: '财务风险与机会智能体', role: '风险机会', skills: ['finance_opportunity'], autonomy: 'A1' },
  { id: 'AG-FAC-010', name: '财经复盘智能体', role: '复盘', skills: ['finance_review_pack'], autonomy: 'A2' },
] as const;

const snapshot = loadHarbor();
const runtimeId = snapshot.runtimes[0]?.id ?? null;
let created = 0;
for (const definition of FINANCE_AGENTS) {
  if (loadHarbor().agents.some((agent) => agent.businessAgentId === definition.id)) continue;
  createHarborAgent({
    businessAgentId: definition.id,
    name: definition.name,
    role: definition.role,
    description: `M09 FAC 财经自治中心专业智能体：${definition.role}`,
    instructions: '必须遵循 M01 权限门禁、M02 证据链和 M09 财经专业边界。',
    provider: 'openai',
    model: 'provider-default',
    runtimeId,
    hierarchyLevel: 'L2',
    autonomyLevel: definition.autonomy,
    access: 'workspace',
    skills: [...definition.skills],
  });
  created += 1;
}

console.log(JSON.stringify({
  ok: true,
  created,
  total: loadHarbor().agents.filter((agent) => agent.businessAgentId?.startsWith('AG-FAC-')).length,
  runtimeId,
  note: 'M13登记完成不等于可调用；仍需M01注册active且含task:execute。',
}));
