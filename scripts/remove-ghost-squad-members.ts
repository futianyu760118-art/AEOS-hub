// 一次性清理：移出「智能体小队」里没有港湾实体（harborAgentId 为 null）的幽灵成员。
// 只动小队数据（agent-squad.json），不碰 AI 港湾。幂等：已移出的成员跳过。
// 用法：node scripts/remove-ghost-squad-members.ts
import { loadAgentSquad, deleteAgentSquadMember } from '../src/agent-squad-store.ts';

const snapshot = loadAgentSquad();
const ghosts = snapshot.members.filter((member) => member.harborAgentId == null);

const removed: Array<{ id: string; name: string; removedMemoryCount: number; removedMessageCount: number }> = [];
for (const member of ghosts) {
  const { removedMemoryCount, removedMessageCount } = deleteAgentSquadMember({ agentId: member.id });
  removed.push({ id: member.id, name: member.name, removedMemoryCount, removedMessageCount });
}

console.log(JSON.stringify({ removed, remainingMembers: loadAgentSquad().members.length }, null, 2));
