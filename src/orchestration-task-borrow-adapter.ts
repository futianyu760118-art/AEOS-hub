// 把跨系统任务执行器接到现有 BorrowOrderService：
// create → 借调单；waitForTerminal → 轮询借调单终态；错误映射为任务执行错误。
import type { BorrowOrderRecord, BorrowOrderStatus } from './borrow-order-store.ts';
import {
  BorrowOrderServiceError,
  type BorrowOrderService,
} from './borrow-order-service.ts';
import {
  OrchestrationTaskExecutionError,
  type BorrowCreateInput,
  type BorrowCreated,
  type BorrowExecutionPort,
  type BorrowTerminal,
  type BorrowTerminalError,
} from './orchestration-task-executor.ts';

const TERMINAL: ReadonlySet<BorrowOrderStatus> = new Set(['completed', 'failed', 'cancelled']);

export interface BorrowOrderExecutionAdapterOptions {
  borrowOrderService: Pick<BorrowOrderService, 'create' | 'getForSystem'>;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function mapStage(stage: string | undefined): BorrowTerminalError['stage'] {
  if (stage === 'dispatch') return 'dispatch';
  if (stage === 'execution' || stage === 'reconcile') return 'execution';
  return 'execution';
}

function terminalFromOrder(order: BorrowOrderRecord): BorrowTerminal {
  if (order.status === 'completed') {
    return { status: 'completed', result: order.result ?? null };
  }
  if (order.status === 'cancelled') {
    return {
      status: 'failed',
      error: { code: 'TASK_CANCELLED', message: '借调单已取消', stage: 'execution' },
    };
  }
  return {
    status: 'failed',
    error: {
      code: order.error?.code ?? 'EXECUTION_FAILED',
      message: order.error?.message ?? '借调执行失败',
      stage: mapStage(order.error?.stage),
    },
  };
}

export class BorrowOrderExecutionAdapter implements BorrowExecutionPort {
  private readonly service: Pick<BorrowOrderService, 'create' | 'getForSystem'>;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: BorrowOrderExecutionAdapterOptions) {
    this.service = options.borrowOrderService;
    this.pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 500);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async create(input: BorrowCreateInput): Promise<BorrowCreated> {
    try {
      const result = this.service.create({
        fromSystem: input.fromSystem,
        body: {
          requestId: input.requestId,
          capability: input.capability,
          input: input.input,
          toSystem: input.systemId,
        },
      });
      return { orderId: result.order.orderId, runId: result.order.runId };
    } catch (error) {
      if (error instanceof BorrowOrderServiceError) {
        throw new OrchestrationTaskExecutionError(error.code, error.message, 'dispatch');
      }
      throw new OrchestrationTaskExecutionError(
        'DISPATCH_FAILED',
        (error as Error).message || '借调派单失败',
        'dispatch',
      );
    }
  }

  async waitForTerminal(orderId: string, timeoutMs: number, fromSystem: string): Promise<BorrowTerminal> {
    const deadline = this.now() + Math.max(1, timeoutMs);
    while (this.now() < deadline) {
      let order: BorrowOrderRecord;
      try {
        order = this.service.getForSystem(fromSystem, orderId);
      } catch (error) {
        if (error instanceof BorrowOrderServiceError) {
          throw new OrchestrationTaskExecutionError(error.code, error.message, 'execution');
        }
        throw new OrchestrationTaskExecutionError(
          'EXECUTION_FAILED',
          (error as Error).message || '读取借调单失败',
          'execution',
        );
      }
      if (TERMINAL.has(order.status)) return terminalFromOrder(order);
      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
    throw new OrchestrationTaskExecutionError(
      'TASK_TIMEOUT',
      `借调单 ${orderId} 超过 ${timeoutMs}ms 未完成`,
      'timeout',
    );
  }
}
