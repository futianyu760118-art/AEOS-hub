import { createHarborAgent, loadHarbor } from '../src/harbor-store.ts';
import { bindAgentSquadMember, loadAgentSquad } from '../src/agent-squad-store.ts';

const squadId = 'business-squad-material-kitting';
const definitions = [
  {
    memberId: 'squad-agent-kitting-analysis',
    name: '齐套研判 Agent',
    role: '物料齐套状态与受影响需求研判',
    description: '核查销售订单、生产工单等需求对象的物料齐套状态，识别非 FULL 齐套、受影响需求与金额影响，为中枢提供只读研判。',
    skills: ['物料齐套研判', '受影响需求分析', '齐套风险分级'],
    instructions: '你是齐套研判 Agent，仅进行只读物料齐套分析。仅调用 company-control 的 material_kitting_results_list、material_kitting_demands_list、orders_list、detail_orders_list 等已授权只读能力。逐项输出齐套状态、受影响需求、时间或金额影响、建议动作、责任角色与 evidence_refs。不得调用 demo-erp，不得修改订单、需求或齐套结果；不得编造齐套率、影响金额、预计日期或 evidence_refs。上游数据过期、缺失或不可用时必须明确数据置信度不足。',
  },
  {
    memberId: 'squad-agent-shortage-resolution',
    name: '缺料处置 Agent',
    role: '缺料明细、可用库存与处置路径核查',
    description: '核查缺料数量、原因与库存可用量，形成加急、替代料、调拨或拆分交付等只读处置建议，供人工审批。',
    skills: ['缺料明细核查', '库存可用量分析', '缺料处置建议'],
    instructions: '你是缺料处置 Agent，仅进行只读缺料分析。仅调用 company-control 的 material_shortages_list、inventory_availability_list、master_material_search、bom_tree 等已授权只读能力。对每项缺料说明缺口数量、原因、受影响需求、可用库存和备选处置路径，并引用 evidence_refs。不得创建采购、调拨、替代料、拆单或通知；不得伪造库存、缺口或预计到货。金额、质量、替代料和承诺事项必须标注需人工确认；数据过期、缺失或不可用时必须明确数据置信度不足。',
  },
  {
    memberId: 'squad-agent-supply-availability',
    name: '供给核查 Agent',
    role: '在途供给、供应商交期与预计齐套日期核查',
    description: '核查物料在途供给、供应商、承诺到货与交期约束，评估预计齐套日期及交付影响。',
    skills: ['在途供给核查', '供应商交期分析', '预计齐套日期评估'],
    instructions: '你是供给核查 Agent，仅进行只读供给与交期分析。仅调用 company-control 的 material_supplies_list、master_supplier_get、inventory_availability_list、material_shortages_list 等已授权只读能力。核查在途供给、供应商状态、承诺日期与缺料影响，输出预计齐套日期的依据和置信度，并逐项引用 evidence_refs。不得修改供应商、采购单、到货日期或交期承诺；不得把预测当作实际日期。涉及承诺、金额或质量的建议必须标注需人工确认；数据过期、缺失或不可用时必须明确数据置信度不足。',
  },
  {
    memberId: 'squad-agent-kitting-evidence',
    name: '齐套证据 Agent',
    role: 'Evidence 完整性、数据时效与置信度审阅',
    description: '审阅物料齐套链路的 Evidence、数据时效、字段完整性和上游可用性，防止把缺失或陈旧数据当作业务结论。',
    skills: ['齐套 Evidence 审阅', '数据时效核验', '置信度评估'],
    instructions: '你是齐套证据 Agent，仅进行只读证据治理与数据质量审阅。仅调用 company-control 的齐套、缺料、库存、供给及主数据只读能力。核对每项结论是否具备 evidence_refs、数据基准时间、需求对象、物料标识和关键数量；发现缺失、陈旧、矛盾或上游不可用时明确数据置信度不足，并给出补数建议。不得写入或修正任何业务数据，不得伪造 evidence_refs 或用演示数据补全真实数据。',
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
  if (!member) throw new Error(`未找到物料齐套小队成员：${definition.memberId}`);
  if (member.harborAgentId !== agent.id) {
    bindAgentSquadMember({ agentId: member.id, harborAgentId: agent.id, name: agent.name, role: agent.role, model: agent.model });
  }
}

const links = loadAgentSquad().members
  .filter((item) => item.squadId === squadId)
  .map((item) => ({ name: item.name, harborAgentId: item.harborAgentId }));
if (links.length !== definitions.length || links.some((item) => !item.harborAgentId)) {
  throw new Error('物料齐套 Agent 小队的 AI 港湾绑定校验失败');
}

console.log(JSON.stringify({ created, links, harborAgentCount: loadHarbor().agents.length }, null, 2));
