export function questionDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hashUnit(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 1) / 4294967297;
}

function roleMatches(question, role) {
  const roles = Array.isArray(question.roles) ? question.roles : [];
  if (!roles.length) return true;
  const normalizedRole = String(role || '').trim().toLocaleLowerCase('zh-CN');
  return roles.some((item) => String(item).trim().toLocaleLowerCase('zh-CN') === normalizedRole);
}

export function selectDailyQuestions(config, options = {}) {
  const dateKey = options.dateKey || questionDateKey();
  const role = String(options.role || '决策责任人');
  const offset = Math.max(0, Number(options.offset) || 0);
  const count = Math.max(1, Math.min(12, Number(config?.displayCount) || 6));
  const enabled = (config?.questions || []).filter((question) => (
    question?.enabled
    && (question.source !== 'generated' || question.generatedDate === dateKey)
  ));
  const candidates = enabled.filter((question) => roleMatches(question, role));
  const ranked = candidates.map((question) => {
    const weight = Math.max(1, Math.min(101, Number(question.priority) + 1 || 1));
    const unit = hashUnit(`${dateKey}|${role}|${question.id}`);
    return { question, sourceRank: question.source === 'generated' ? 0 : 1, score: -Math.log(unit) / weight };
  }).sort((left, right) => (
    left.sourceRank - right.sourceRank
    || left.score - right.score
    || left.question.id.localeCompare(right.question.id)
  ));
  if (!ranked.length) return [];
  const start = offset % ranked.length;
  return Array.from({ length: Math.min(count, ranked.length) }, (_, index) => ranked[(start + index) % ranked.length].question);
}
