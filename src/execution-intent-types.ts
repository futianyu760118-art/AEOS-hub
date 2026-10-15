// 执行面查询能力的「意图语义」元数据：Agent 自描述"自然语言 → path+params"的映射。
// Hub 的 LLM 意图解析与前端渲染据此动态生成，不再硬编码任何具体系统的查询语义。
export interface QueryIntentParamEnum {
  value: string | number;
  label: string;
}

export interface QueryIntentParam {
  name: string;
  label?: string;
  keywords?: string[];
  enum?: QueryIntentParamEnum[];
}

export interface QueryIntentPath {
  path: string;
  label: string;
  keywords?: string[];
  params?: QueryIntentParam[];
  /** 前端渲染提示：标题字段与展示字段顺序（可选，缺省则泛化渲染）。 */
  output?: { title?: string[]; fields?: string[] };
}

export interface QueryIntent {
  paths: QueryIntentPath[];
}
