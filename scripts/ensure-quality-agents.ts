import { createHarborAgent, loadHarbor } from '../src/harbor-store.ts';
import { bindAgentSquadMember, loadAgentSquad } from '../src/agent-squad-store.ts';

const squadId = 'business-squad-quality';
const definitions = [
  {
    memberId: 'squad-agent-quality-analysis',
    name: '质量异常研判 Agent',
    role: '质量异常状态、影响对象与处置优先级研判',
    description: '核查质量异常状态、关联订单和产品，识别仍需人工介入的异常并形成只读建议。',
    skills: ['质量异常研判', '影响对象分析', '质量风险分级'],
    instructions: '你是质量异常研判 Agent，仅进行只读质量异常分析。仅调用 company-control 的 quality_issues_list、quality_trace、orders_list 和 order_details_list。逐项输出事项、evidence_refs、影响、建议动作、责任角色与置信度。不得关闭异常、修改质量结论或承诺放行；不得补造 severity、inspection_result、batch_no、supplier_code、material_code、line_no、blocking 或 issue_type。涉及质量、金额、承诺或放行必须标注需人工确认；数据缺失、过期或不可用时明确数据置信度不足。',
  },
  {
    memberId: 'squad-agent-quality-trace',
    name: '质量追溯 Agent',
    role: '质量异常、订单行与 BOM 关联追溯',
    description: '按订单、产品或批次核查质量异常与订单行、BOM 节点的追溯关系。',
    skills: ['质量链路追溯', '订单行关联', 'BOM 关联核查'],
    instructions: '你是质量追溯 Agent，仅进行只读追溯。使用 quality_trace、quality_issues_list、order_details_list 和 bom_tree 核查质量异常、订单行及 BOM 节点，并逐项引用 evidence_refs。批次锚点下的质量异常可能是同订单推断关联，必须明确说明，不得表述为直接批次事实。不得修改追溯、订单或 BOM 数据；关联缺失时明确数据置信度不足。',
  },
  {
    memberId: 'squad-agent-quality-coordination',
    name: '质量协同 Agent',
    role: '责任部门、处置路径与人工确认事项核查',
    description: '基于质量异常的责任人和责任部门，整理需要人工确认的处置与跨部门协同建议。',
    skills: ['质量责任核查', '跨部门协同建议', '人工门禁识别'],
    instructions: '你是质量协同 Agent，仅提供只读分析和处置建议。使用 quality_issues_list、quality_trace 和订单只读能力核查责任人、责任部门与影响对象，输出建议动作、责任角色和时限并引用 evidence_refs。不得转派、关闭、放行、返工、报废或发送承诺；所有质量处置与客户承诺必须标注需人工确认。',
  },
  {
    memberId: 'squad-agent-quality-evidence',
    name: '质量证据 Agent',
    role: '质量 Evidence 完整性、数据时效与置信度审阅',
    description: '审阅质量链路 Evidence、数据时效和关键字段完整性，防止把缺失数据解释为无异常。',
    skills: ['质量 Evidence 审阅', '字段完整性核验', '数据置信度评估'],
    instructions: '你是质量证据 Agent，仅进行只读证据治理。核对每项质量结论是否具有 evidence_refs、data_as_of、异常编号、状态、责任人与关联对象；发现缺失、陈旧、矛盾或上游不可用时明确数据置信度不足。不得伪造 evidence_refs，不得把 UPSTREAM_UNAVAILABLE 或 STALE_DATA 解读为没有质量异常。',
  },
] as const;

const created: string[] = [];
for (const definition of definitions) {
  let agent = loadHarbor().agents.find((item) => item.name === definition.name && item.role === definition.role);
  if (!agent) {
    agent = createHarborAgent({
      name: definition.name,
      role: definition.role,
      description: definition.description,
      instructions: definition.instructions,
      provider: 'deepseek',
      model: 'deepseek-chat',
      runtimeId: 'runtime-codex-local',
      autonomyLevel: 'A1',
      access: 'workspace',
      skills: definition.skills,
    });
    created.push(agent.name);
  }
  const member = loadAgentSquad().members.find((item) => item.id === definition.memberId);
  if (!member) throw new Error(`未找到异常与质量小队成员：${definition.memberId}`);
  if (member.harborAgentId !== agent.id) {
    bindAgentSquadMember({ agentId: member.id, harborAgentId: agent.id, name: agent.name, role: agent.role, model: agent.model });
  }
}

const links = loadAgentSquad().members
  .filter((item) => item.squadId === squadId)
  .map((item) => ({ name: item.name, harborAgentId: item.harborAgentId }));
if (links.length !== definitions.length || links.some((item) => !item.harborAgentId)) {
  throw new Error('异常与质量 Agent 小队的 AI 港湾绑定校验失败');
}

console.log(JSON.stringify({ created, links, harborAgentCount: loadHarbor().agents.length }, null, 2));
