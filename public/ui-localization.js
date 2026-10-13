const PHRASE_REPLACEMENTS = [
  ['api endpoint not found', '接口未找到'],
  ['task endpoint not found', '任务接口未找到'],
  ['authentication required', '需要登录后才能访问'],
  ['method not allowed', '不支持该请求方式'],
  ['UPSTREAM_UNAVAILABLE', '中台服务不可达'],
  ['UPSTREAM_TIMEOUT', '中台服务响应超时'],
  ['MCP_NOT_READY', '中台只读能力尚未就绪'],
  ['AUTONOMOUS ENTERPRISE OS', '自治企业操作系统'],
  ['Accountable Owner', '责任业务负责人'],
  ['Capability Registry', '能力注册表'],
  ['System Registry', '系统注册表'],
  ['Codex Runtime', 'Codex 运行时'],
  ['Runtime Adapter', '运行时适配器'],
  ['Work Item', '工作项'],
  ['Custom CLI', '自定义命令行'],
  ['OpenAI Responses', 'OpenAI 响应接口'],
  ['Codex App Server', 'Codex 应用服务'],
  ['MCP Agent', 'MCP 智能体'],
  ['Agent 小队', '智能体小队'],
  ['中枢 Agent', '中枢智能体'],
  ['业务 Agent', '业务智能体'],
  ['专业 Agent', '专业智能体'],
  ['工具 Agent', '工具智能体'],
  ['Evidence 证据', '证据'],
  ['Evidence', '证据'],
  ['Capability', '能力'],
  ['Registry', '注册表'],
  ['Runtime', '运行时'],
  ['Agent', '智能体'],
  ['Attention', '关注'],
  ['Inbox', '收件箱'],
  ['Guard', '治理门禁'],
  ['Owner', '业务负责人'],
  ['Verify', '核验'],
  ['Skills', '技能'],
  ['System', '系统'],
  ['Server', '服务'],
  ['TOP', '重点'],
  ['FULL', '完整齐套'],
  ['Objective', '目标'],
  ['Pilot', '试点'],
  ['manager', '管理者'],
  ['operator', '操作员'],
  ['owner', '业务负责人'],
  ['human', '人工用户'],
];

const EXACT_VALUE_LABELS = {
  healthy: '健康', degraded: '降级', unavailable: '不可用', unknown: '未知',
  working: '执行中', idle: '空闲', offline: '离线', standby: '待命',
  draft: '草稿', suspended: '已暂停', paused: '已暂停', registered: '已登记',
  verified: '已验证', available: '可调用', completed: '已完成', closed: '已闭环',
  active: '进行中', blocked: '已阻塞', pending: '待处理', read: '已读', unread: '未读',
};

const ERROR_LABELS = {
  'api endpoint not found': '接口未找到',
  'task endpoint not found': '任务接口未找到',
  'authentication required': '需要登录后才能访问',
  'method not allowed': '不支持该请求方式',
  'UPSTREAM_UNAVAILABLE': '中台服务不可达',
  'UPSTREAM_TIMEOUT': '中台服务响应超时',
  'MCP_NOT_READY': '中台只读能力尚未就绪',
  'MCP_NOT_READ_ONLY': '中台能力未确认只读，已拒绝调用',
};

export function localizeUiText(value, { exactOnly = false } = {}) {
  const text = String(value ?? '');
  if (Object.hasOwn(ERROR_LABELS, text)) return ERROR_LABELS[text];
  if (Object.hasOwn(EXACT_VALUE_LABELS, text)) return EXACT_VALUE_LABELS[text];
  if (exactOnly) return text;
  return PHRASE_REPLACEMENTS.reduce((result, [source, target]) => result.replaceAll(source, target), text);
}

function localizeElement(element, { exactOnly }) {
  if (!(element instanceof Element) || element.matches('script, style, template, code, pre, [data-no-localize]')) return;
  for (const attribute of ['placeholder', 'title', 'aria-label', 'data-title']) {
    if (element.hasAttribute(attribute)) element.setAttribute(attribute, localizeUiText(element.getAttribute(attribute), { exactOnly }));
  }
  for (const node of [...element.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) node.textContent = localizeUiText(node.textContent, { exactOnly });
    else if (node.nodeType === Node.ELEMENT_NODE) localizeElement(node, { exactOnly });
  }
}

/** Localizes presentation text only; it never changes stored records or API payloads. */
export function localizeStaticDocument(root = document) {
  localizeElement(root.documentElement || root, { exactOnly: false });
}

/** Re-applies the presentation vocabulary to system-rendered view fragments. */
export function localizeDynamicCopy(root = document) {
  localizeElement(root, { exactOnly: false });
}
