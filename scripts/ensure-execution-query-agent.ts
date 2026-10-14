// 手动注册执行面查询 Agent（幂等）。服务启动时也会自动调用同一函数，通常无需手动跑本脚本。
import { ensureExecutionQueryAgent } from '../src/execution-query-agent-seed.ts';

const result = ensureExecutionQueryAgent();
console.log(JSON.stringify(result, null, 2));
