// 轻量 schema 校验（JSON Schema 的一个极小子集），供执行面能力自描述后做通用输入/结果结构校验。
// 覆盖：type(object/array/string/number/boolean)、properties、items、required、enum、maxLength、minItems。
// 约定：不校验未知字段（additionalProperties 默认放行），保证 Agent 增加字段向前兼容。
export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'boolean';

export interface Schema {
  type: SchemaType;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: (string | number)[];
  maxLength?: number;
  minItems?: number;
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** 校验 value 是否符合 schema；通过返回 null，否则返回可读的错误描述。 */
export function validateAgainstSchema(value: unknown, schema: Schema): string | null {
  if (!schema || typeof schema !== 'object' || typeof schema.type !== 'string') return 'schema 无效';
  const { type } = schema;

  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return `期望 object，实际为 ${typeName(value)}`;
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record) || record[key] === undefined) return `缺少必填字段 ${key}`;
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in record && record[key] !== undefined) {
          const issue = validateAgainstSchema(record[key], sub);
          if (issue) return `字段 ${key}：${issue}`;
        }
      }
    }
    return null;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return `期望 array，实际为 ${typeName(value)}`;
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `数组长度 ${value.length} 小于最小要求 ${schema.minItems}`;
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i += 1) {
        const issue = validateAgainstSchema(value[i], schema.items);
        if (issue) return `第 ${i} 项：${issue}`;
      }
    }
    return null;
  }

  if (type === 'string') {
    if (typeof value !== 'string') return `期望 string，实际为 ${typeName(value)}`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `字符串长度 ${value.length} 超过上限 ${schema.maxLength}`;
    }
    if (schema.enum && !schema.enum.includes(value)) return `值 "${value}" 不在允许范围`;
    return null;
  }

  if (type === 'number') {
    if (typeof value !== 'number') return `期望 number，实际为 ${typeName(value)}`;
    if (schema.enum && !schema.enum.includes(value)) return `值 ${value} 不在允许范围`;
    return null;
  }

  if (type === 'boolean') {
    if (typeof value !== 'boolean') return `期望 boolean，实际为 ${typeName(value)}`;
    return null;
  }

  return `不支持的 schema type: ${String(type)}`;
}
