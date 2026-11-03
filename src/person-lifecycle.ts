import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type PersonLifecycleEvent = {
  event_id: string;
  event_type: 'person.offboarded' | 'person.reinstated';
  tenant_id: string;
  object_id: string;
  revision: number;
  idempotency_key: string;
  person: {
    person_id: string;
    emp_code?: string;
    agent_ids?: string[];
  };
  [key: string]: unknown;
};

export type LifecycleAgent = {
  id: string;
  tenant_id?: string;
  status?: string;
  owner_person_id?: string | null;
  execution_identity_person_id?: string | null;
  m01Registration?: { state?: string; [key: string]: unknown };
};

type LifecycleState = {
  version: 1;
  events: Array<Record<string, unknown> & { idempotency_key: string; object_id: string; tenant_id: string; revision: number; result: Record<string, unknown> }>;
  people: Record<string, { tenant_id: string; status: string; access: string; agent_ids: string[] }>;
  checklists: Array<Record<string, unknown>>;
};

const defaultState = (): LifecycleState => ({ version: 1, events: [], people: {}, checklists: [] });

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function personKey(event: Pick<PersonLifecycleEvent, 'tenant_id' | 'object_id'>): string {
  return `${event.tenant_id}:${event.object_id}`;
}

export class PersonLifecycleService {
  private readonly file: string;
  private state: LifecycleState;

  constructor(file: string, initialState?: Partial<LifecycleState>) {
    this.file = file;
    this.state = initialState ? { ...defaultState(), ...clone(initialState) } : this.load();
  }

  private load(): LifecycleState {
    if (!existsSync(this.file)) return defaultState();
    return { ...defaultState(), ...JSON.parse(readFileSync(this.file, 'utf8')) } as LifecycleState;
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2));
    renameSync(temp, this.file);
  }

  snapshot(): LifecycleState {
    return clone(this.state);
  }

  apply(event: PersonLifecycleEvent, options: { agents?: LifecycleAgent[]; ownerPersonId?: string | null } = {}): Record<string, unknown> {
    const configuredTenant = String(process.env.AEOS_TENANT_ID || '').trim();
    if (configuredTenant && event.tenant_id !== configuredTenant) {
      return { event_id: event.event_id, target_system: 'M13_AEOS_HUB', status: 'failed', changed: {}, received_at: new Date().toISOString(), reason: 'tenant_mismatch' };
    }
    const existing = this.state.events.find((item) => item.idempotency_key === event.idempotency_key);
    if (existing) return { ...clone(existing.result), duplicate: true };
    const current = this.state.events
      .filter((item) => item.tenant_id === event.tenant_id && item.object_id === event.object_id)
      .sort((a, b) => b.revision - a.revision)[0];
    if (current && event.revision < current.revision) {
      return { status: 'stale', state: 'stale', event_id: event.event_id, duplicate: false };
    }

    const key = personKey(event);
    const person = this.state.people[key] ?? {
      tenant_id: event.tenant_id, status: 'active', access: 'active', agent_ids: [],
    };
    const result: Record<string, unknown> = {
      status: 'synced', state: 'active', event_id: event.event_id, duplicate: false,
      closed_items: [], pending_confirmation: { permissions: false, agents: false },
      revoked_agent_ids: [],
    };
    const agents = options.agents ?? [];

    if (event.event_type === 'person.offboarded') {
      person.status = 'inactive';
      person.access = 'revoked';
      const requested = new Set(event.person.agent_ids ?? []);
      const revoked = agents
        .filter((agent) => requested.has(agent.id)
          || agent.owner_person_id === event.object_id
          || agent.execution_identity_person_id === event.object_id
          || (options.ownerPersonId && options.ownerPersonId === event.object_id))
        .map((agent) => agent.id);
      person.agent_ids = [...new Set([...person.agent_ids, ...revoked])];
      result.status = 'synced';
      result.state = 'offboarded';
      result.closed_items = ['agent_owner', 'execution_identity'];
      result.revoked_agent_ids = [...new Set(revoked)];
      this.state.checklists.push(
        { id: `check-${randomUUID()}`, event_id: event.event_id, tenant_id: event.tenant_id, person_id: event.object_id, item_type: 'agent_owner', status: 'closed', detail: '已撤销 Agent 负责人关系' },
        { id: `check-${randomUUID()}`, event_id: event.event_id, tenant_id: event.tenant_id, person_id: event.object_id, item_type: 'execution_identity', status: 'closed', detail: '已停止该人员对应的 Agent 执行身份' },
      );
    } else if (event.event_type === 'person.reinstated') {
      person.status = 'active';
      person.access = 'basic_pending_confirmation';
      result.status = 'pending_confirmation';
      result.pending_confirmation = { permissions: true, agents: true };
      this.state.checklists.push(
        { id: `check-${randomUUID()}`, event_id: event.event_id, tenant_id: event.tenant_id, person_id: event.object_id, item_type: 'agent_restore', status: 'pending_confirmation', detail: '复职后需要管理员确认是否恢复 Agent 负责人关系' },
      );
    } else {
      throw new Error(`不支持的人员状态事件：${event.event_type}`);
    }

    this.state.people[key] = person;
    const record = { ...event, result } as LifecycleState['events'][number];
    this.state.events.push(record);
    this.persist();
    return clone(result);
  }
}

export function createPersonLifecycleService(file = join(process.cwd(), 'data', 'person-lifecycle.json'), initialState?: Partial<LifecycleState>): PersonLifecycleService {
  return new PersonLifecycleService(file, initialState);
}
