// 执行面配置变更审计：监听准入/授权/选路三张配置的哈希变化，变更写入 evidence。
// 只读文件、不改配置；首次检查只建基线，不产生审计，避免每次重启都写一条。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { executionAgentAllowlistFile, loadExecutionAgentAllowlist } from './execution-agent-policy.ts';
import { executionAgentPermissionsFile, loadExecutionAgentPermissions } from './execution-agent-permissions.ts';
import { executionRoutingPolicyFile, loadExecutionRoutingPolicy } from './execution-routing-policy.ts';
import type { EvidenceInput } from './evidence.ts';

export type ExecutionPolicyFileSpec = {
  name: string;
  file: string;
  /** 当前配置版本号；文件损坏时返回 null。 */
  revision: () => number | null;
};

export function executionPolicyFiles(): ExecutionPolicyFileSpec[] {
  return [
    {
      name: 'agent-allowlist',
      file: executionAgentAllowlistFile,
      revision: () => {
        try { return loadExecutionAgentAllowlist().revision; } catch { return null; }
      },
    },
    {
      name: 'agent-permissions',
      file: executionAgentPermissionsFile,
      revision: () => {
        try { return loadExecutionAgentPermissions().revision; } catch { return null; }
      },
    },
    {
      name: 'routing-policy',
      file: executionRoutingPolicyFile,
      revision: () => {
        try { return loadExecutionRoutingPolicy().revision; } catch { return null; }
      },
    },
  ];
}

export function hashPolicyFile(file: string): string | null {
  try {
    if (!existsSync(file)) return null;
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

export type ExecutionPolicyAuditor = {
  /** 立即检查一次；首次调用只建基线。 */
  check: () => void;
  start: () => void;
  stop: () => void;
};

export function createExecutionPolicyAuditor(options: {
  appendEvidence: (input: EvidenceInput) => unknown;
  files?: ExecutionPolicyFileSpec[];
  hashFile?: (file: string) => string | null;
  intervalMs?: number;
  clock?: () => Date;
  onWarn?: (message: string) => void;
}): ExecutionPolicyAuditor {
  const files = options.files ?? executionPolicyFiles();
  const hashFile = options.hashFile ?? hashPolicyFile;
  const intervalMs = options.intervalMs ?? 30_000;
  const clock = options.clock ?? (() => new Date());
  const snapshots = new Map<string, string | null>();
  let timer: NodeJS.Timeout | null = null;

  const check = () => {
    for (const spec of files) {
      const hash = hashFile(spec.file);
      const previous = snapshots.get(spec.file);
      if (previous === undefined) {
        snapshots.set(spec.file, hash);
        continue;
      }
      if (previous === hash) continue;
      snapshots.set(spec.file, hash);
      try {
        options.appendEvidence({
          kind: 'app_event',
          actor_id: 'hub-config-watcher',
          actor_type: 'system',
          object_ref: 'hub://execution-policy',
          source_system: 'aeos-hub',
          correlation_id: 'execution-policy-changed',
          summary: `execution policy changed: ${spec.name}`,
          payload: {
            name: spec.name,
            file: spec.file,
            previousHash: previous,
            hash,
            revision: spec.revision(),
            changedAt: clock().toISOString(),
          },
        });
      } catch (error) {
        options.onWarn?.(`[policy-audit] 写入变更审计失败：${(error as Error).message}`);
      }
    }
  };

  return {
    check,
    start: () => {
      if (timer) return;
      check();
      timer = setInterval(check, intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
