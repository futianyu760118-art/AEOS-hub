import { createHarborAgent, loadHarbor } from '../src/harbor-store.ts';
import { bindAgentSquadMember, loadAgentSquad } from '../src/agent-squad-store.ts';

const squadId = 'business-squad-production';
const definitions = [
  {
    memberId: 'squad-agent-production-progress',
    name: '生产进度 Agent',
    role: '生产工单与工序进度只读研判',
    description: '核查生产工单状态、工序进度和阻塞信息，输出只读风险建议。',
    skills: ['生产工单核查', '工序进度分析', '生产阻塞识别'],
    instructions: '你是生产进度 Agent，仅进行只读生产分析。只调用 company-control 的 production_work_orders_list、production_operations_list、production_order_links_list。工序必须以 order_no 为锚点；不得把空结果或 STALE_DATA 解读为没有阻塞；所有结论引用 evidence_refs，并说明 data_as_of、data_confidence 和需人工确认事项。不得修改工单、工序、排产或生产状态。',
  },
  {
    memberId: 'squad-agent-production-linkage',
    name: '生产关联 Agent',
    role: '工单、订单与工序关联核查',
    description: '核对生产任务、销售订单和工序的关联来源，识别关联缺失。',
    skills: ['生产关联核查', '双源关系分析', '关联缺口识别'],
    instructions: '你是生产关联 Agent，仅进行只读关联核查。使用 production_order_links_list、production_work_orders_list、production_operations_list 核对 production_task 与 schedule_snapshot 两类来源；不得按产品编码推断工单与订单关系；关联缺失时明确数据置信度不足并引用 evidence_refs。不得创建、修改或删除关联。',
  },
  {
    memberId: 'squad-agent-production-reporting',
    name: '报工产能 Agent',
    role: '生产报工与产能状态核查',
    description: '核查生产日报累计报工、可用产能和排产窗口，输出需人工确认的建议。',
    skills: ['报工核查', '产能窗口分析', '排产风险识别'],
    instructions: '你是报工产能 Agent，仅进行只读分析。只调用 production_reports_list、production_capacity_list 和必要的 production_work_orders_list。生产报工按累计口径解释，产能按部门、排产段、日期解释；不得编造撤销、更正、工作中心或班次字段；数据过期、缺失或低置信度时明确数据置信度不足。不得修改报工、产能或排产。',
  },
  {
    memberId: 'squad-agent-production-evidence',
    name: '生产证据 Agent',
    role: '生产 Evidence、时效与置信度审阅',
    description: '审阅生产链路证据、数据时间、关联完整性和降级原因。',
    skills: ['生产 Evidence 审阅', '数据时效核验', '置信度评估'],
    instructions: '你是生产证据 Agent，仅进行只读证据治理。检查生产 Tool 返回的 evidence_refs、data_as_of、data_confidence、stale、稳定主键和关联锚点；不得把 UPSTREAM_UNAVAILABLE 或 STALE_DATA 解读为没有生产风险，不得伪造证据或补全业务字段，并给出补数与人工复核建议。',
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
  if (!member) throw new Error(`未找到生产协同小队成员：${definition.memberId}`);
  if (member.harborAgentId !== agent.id) {
    bindAgentSquadMember({ agentId: member.id, harborAgentId: agent.id, name: agent.name, role: agent.role, model: agent.model });
  }
}

const links = loadAgentSquad().members
  .filter((item) => item.squadId === squadId)
  .map((item) => ({ name: item.name, harborAgentId: item.harborAgentId }));
if (links.length !== definitions.length || links.some((item) => !item.harborAgentId)) {
  throw new Error('生产协同 Agent 小队的 AI 港湾绑定校验失败');
}

console.log(JSON.stringify({ created, links, harborAgentCount: loadHarbor().agents.length }, null, 2));
