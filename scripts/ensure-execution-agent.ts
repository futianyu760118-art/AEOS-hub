// 手动注册公司中台执行面智能体（幂等）。服务启动时也会自动调用同一函数，通常无需手动跑本脚本。
import { ensureExecutionAgent } from '../src/execution-agent-seed.ts';

const result = ensureExecutionAgent();
console.log(JSON.stringify(result, null, 2));
