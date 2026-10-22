// 能力调用服务：把系统传入的 capability + params 按模板渲染成只读借调单。
// Hub 是唯一路由方；调用方不指定目标 URL，也不直接理解 PLM/ERP/MES 的私有查询参数。
import { randomUUID } from 'node:crypto';
import type { ExecutionPlaneRegistry } from './execution-plane.ts';
import {
  BorrowOrderService,
  BorrowOrderServiceError,
  borrowOrderSummary,
} from './borrow-order-service.ts';
import type { BorrowOrderRecord } from './borrow-order-store.ts';
import {
  CapabilityQueryTemplateError,
  parseCapabilityQueryTemplate,
  renderCapabilityQuery,
  validateInvocationRequestId,
  type CapabilityQueryTemplate,
} from './capability-query-template.ts';

export interface CapabilityInvocationRequestBody {
  capability?: unknown;
  params?: unknown;
  requestId?: unknown;
  fromAgentId?: unknown;
}

export interface CapabilityInvocationRequest {
  fromSystem: string;
  body?: CapabilityInvocationRequestBody | Record<string, unknown>;
}

export interface CapabilityInvocationResult {
  capability: string;
  templateVersion: string;
  order: Omit<BorrowOrderRecord, 'input' | 'result'>;
  idempotent: boolean;
}

export class CapabilityInvocationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, httpStatus: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = 'CapabilityInvocationError';
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

const DEFAULT_TEMPLATES: CapabilityQueryTemplate[] = [
  {
    capability: 'query_plm',
    version: '1.0.0',
    title: '查询 PLM 研发项目',
    description: '按项目号或关键字查询恒剑 PLM 研发项目。',
    domain: 'plm',
    providerSystem: 'hengjian-plm',
    providerAgentId: 'runtime-execution-query',
    readOnly: true,
    requestTemplate: {
      path: '/project/page',
      params: {
        keyword: '{{keyword}}',
        pageNum: '{{pageNum}}',
        pageSize: '{{pageSize}}',
      },
    },
    parameterSchema: {
      type: 'object',
      required: ['keyword'],
      properties: {
        keyword: { type: 'string', maxLength: 160 },
        pageNum: { type: 'integer' },
        pageSize: { type: 'integer' },
      },
    },
    parameterDefaults: {
      pageNum: 1,
      pageSize: 5,
    },
    intent: {
      keywords: ['PLM', '研发项目', '研发', '项目', '图纸', '立项'],
      examples: [
        '查 PLM 项目 HJ.26033.V1.256JY',
        '查询研发项目 HJ.26033.V1.256JY',
      ],
      parameterHints: {
        keyword: 'identifier',
      },
    },
  },
  {
    capability: 'query_control_platform',
    version: '1.0.0',
    title: '查询中台只读业务数据',
    description: '按中台冻结白名单查询订单、齐套、物料、供应商、质量、生产等只读数据。',
    domain: 'control-platform',
    providerSystem: 'control-platform',
    providerAgentId: 'runtime-control-platform-query',
    readOnly: true,
    requestTemplate: {
      path: '{{path}}',
      params: '{{params}}',
    },
    parameterSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          enum: [
            '/common/ping',
            '/external/orders/list',
            '/external/order-details/list',
            '/external/boms/tree',
            '/external/materials/list',
            '/external/suppliers/list',
            '/external/material-kitting/results',
            '/external/material-kitting/shortages',
            '/external/material-kitting/demands',
            '/external/inventory/availability',
            '/external/material-supplies/list',
            '/external/quality-issues/list',
            '/external/quality-trace/list',
            '/external/production/work-orders/list',
            '/external/production/operations/list',
            '/external/production/order-links/list',
            '/external/production/reports/list',
            '/external/production/capacity/list',
          ],
        },
        params: { type: 'object' },
      },
    },
    parameterDefaults: {
      params: {},
    },
  },
];

function mergeTemplates(defaults: CapabilityQueryTemplate[], overrides: unknown): CapabilityQueryTemplate[] {
  if (overrides === undefined) return defaults;
  if (!Array.isArray(overrides)) throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', 'capability templates 必须是数组');
  const byCapability = new Map(defaults.map((template) => [template.capability, template]));
  for (const item of overrides) {
    const template = parseCapabilityQueryTemplate(item);
    byCapability.set(template.capability, template);
  }
  return [...byCapability.values()].sort((left, right) => left.capability.localeCompare(right.capability));
}

export class CapabilityInvocationService {
  private readonly templates = new Map<string, CapabilityQueryTemplate>();
  private readonly borrowOrders: BorrowOrderService;
  private readonly idFactory: () => string;

  constructor(dependencies: {
    borrowOrders: BorrowOrderService;
    executionPlane?: ExecutionPlaneRegistry;
    templates?: unknown;
    idFactory?: () => string;
  }) {
    this.borrowOrders = dependencies.borrowOrders;
    this.idFactory = dependencies.idFactory ?? randomUUID;
    for (const template of mergeTemplates(DEFAULT_TEMPLATES, dependencies.templates)) {
      this.templates.set(template.capability, template);
    }
  }

  listTemplates(): Array<Omit<CapabilityQueryTemplate, 'readOnly'>> {
    return [...this.templates.values()]
      .sort((left, right) => left.capability.localeCompare(right.capability))
      .map(({ readOnly: _readOnly, ...template }) => template);
  }

  getTemplate(capability: string): Omit<CapabilityQueryTemplate, 'readOnly'> | null {
    const template = this.templates.get(capability);
    if (!template) return null;
    const { readOnly: _readOnly, ...safe } = template;
    return safe;
  }

  invoke(request: CapabilityInvocationRequest): CapabilityInvocationResult {
    const fromSystem = typeof request.fromSystem === 'string' ? request.fromSystem.trim() : '';
    if (!fromSystem) throw new CapabilityInvocationError('INVALID_ARGUMENT', 400, 'fromSystem 不能为空');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const allowedFields = new Set(['capability', 'params', 'requestId', 'fromAgentId']);
    const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
    if (unknownFields.length) {
      throw new CapabilityInvocationError('INVALID_ARGUMENT', 400, `不支持的字段：${unknownFields.join(', ')}`);
    }

    const capability = typeof body.capability === 'string' ? body.capability.trim() : '';
    if (!capability) throw new CapabilityInvocationError('INVALID_ARGUMENT', 400, 'capability 必填');
    const template = this.templates.get(capability);
    if (!template) {
      throw new CapabilityInvocationError('CAPABILITY_NOT_FOUND', 404, `能力模板不存在：${capability}`);
    }
    if (template.providerSystem === fromSystem) {
      throw new CapabilityInvocationError('SELF_INVOCATION_FORBIDDEN', 403, '不能通过能力调用查询本系统');
    }

    const requestId = body.requestId === undefined
      ? `capinv-${this.idFactory()}`
      : validateInvocationRequestId(body.requestId);
    const fromAgentId = typeof body.fromAgentId === 'string' && body.fromAgentId.trim()
      ? body.fromAgentId.trim().slice(0, 160)
      : 'capability-invocation';

    const input = renderCapabilityQuery(template, body.params);
    const result = this.borrowOrders.create({
      fromSystem,
      body: {
        requestId,
        capability: template.capability,
        input,
        toSystem: template.providerSystem,
        ...(template.providerAgentId ? { toAgent: template.providerAgentId } : {}),
        fromAgentId,
      },
    });

    return {
      capability: template.capability,
      templateVersion: template.version,
      order: borrowOrderSummary(result.order),
      idempotent: result.idempotent,
    };
  }
}

export { BorrowOrderServiceError, CapabilityQueryTemplateError };
