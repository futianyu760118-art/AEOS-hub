// 统一目录只读 API：/api/catalog/tree|systems|agents/:id|capabilities。
// 仅 GET；数据来自 AI 港湾、系统登记与执行面注册表的内存读模型。
import {
  buildCapabilityCatalog,
  buildCatalogTree,
  getCatalogAgent,
  type CatalogSources,
} from './agent-catalog.ts';

export type CatalogApiRequest = {
  method?: string;
  pathname: string;
  tenantId?: string;
};

export type CatalogApiResponse = { status: number; body: Record<string, unknown> };

const PATH_PREFIX = '/api/catalog';

export class CatalogApi {
  private readonly loadSources: (tenantId?: string) => CatalogSources;

  constructor(loadSources: (tenantId?: string) => CatalogSources) {
    this.loadSources = loadSources;
  }

  handle(request: CatalogApiRequest): CatalogApiResponse | null {
    if (!request.pathname.startsWith(PATH_PREFIX)) return null;
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      return { status: 405, body: { error: 'method not allowed' } };
    }

    try {
      if (request.pathname === `${PATH_PREFIX}/tree`) {
        return { status: 200, body: { tree: buildCatalogTree(this.loadSources(request.tenantId)) } };
      }
      if (request.pathname === `${PATH_PREFIX}/systems`) {
        const tree = buildCatalogTree(this.loadSources(request.tenantId));
        return { status: 200, body: { systems: tree.systems, counts: tree.counts, warnings: tree.warnings } };
      }
      if (request.pathname === `${PATH_PREFIX}/capabilities`) {
        const tree = buildCatalogTree(this.loadSources(request.tenantId));
        return { status: 200, body: { capabilities: buildCapabilityCatalog(tree) } };
      }
      const agentMatch = request.pathname.match(/^\/api\/catalog\/agents\/([^/]+)$/);
      if (agentMatch) {
        const agentId = decodeURIComponent(agentMatch[1] ?? '').trim();
        if (!agentId) return { status: 400, body: { error: 'agentId invalid' } };
        const detail = getCatalogAgent(buildCatalogTree(this.loadSources(request.tenantId)), agentId);
        if (!detail) return { status: 404, body: { error: 'agent not found', code: 'AGENT_NOT_FOUND' } };
        return { status: 200, body: { agent: detail } };
      }
      return { status: 404, body: { error: 'catalog endpoint not found' } };
    } catch (error) {
      return { status: 500, body: { error: (error as Error).message || 'catalog read failed' } };
    }
  }
}
