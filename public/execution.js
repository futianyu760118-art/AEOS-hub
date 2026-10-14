// 执行面仪表盘：轮询 /api/execution/agents 展示在线执行面 + 运行记录，支持派单/召回。
function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

async function refresh() {
  let data;
  try {
    const res = await fetch('/api/execution/agents');
    if (res.status === 401) { document.body.textContent = '请先登录后再打开本页'; return; }
    data = await res.json();
  } catch {
    return;
  }
  renderAgents(data.agents || []);
  renderRuns(data.runs || []);
}

function renderAgents(agents) {
  const tbody = document.querySelector('#agents tbody');
  tbody.innerHTML = '';
  for (const a of agents) {
    const tr = el('tr');
    const status = el('td', a.connectionStatus);
    status.className = a.connectionStatus;
    tr.append(
      el('td', a.agentId),
      el('td', a.name),
      status,
      el('td', a.runtimeStatus),
      el('td', a.lastSeenAt),
      el('td', a.currentRunId || ''),
      el('td', (a.capabilities || []).map((c) => c.name).join(', ')),
    );
    const recallTd = el('td');
    const btn = el('button', '召回');
    btn.onclick = () => recall(a.agentId);
    recallTd.append(btn);
    tr.append(recallTd);
    tbody.append(tr);
  }
}

function renderRuns(runs) {
  const tbody = document.querySelector('#runs tbody');
  tbody.innerHTML = '';
  for (const r of runs) {
    const result = r.result !== undefined && r.result !== null
      ? JSON.stringify(r.result).slice(0, 240)
      : (r.error ? r.error.message : '');
    const tr = el('tr');
    tr.append(
      el('td', r.runId),
      el('td', r.agentId),
      el('td', r.capability),
      el('td', JSON.stringify(r.input).slice(0, 120)),
      el('td', r.state),
      el('td', r.startedAt),
      el('td', r.endedAt || ''),
      el('td', result),
    );
    tbody.append(tr);
  }
}

async function recall(agentId) {
  try {
    await fetch(`/api/execution/agents/${encodeURIComponent(agentId)}/recall`, { method: 'POST' });
  } finally {
    refresh();
  }
}

document.querySelector('#dispatch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const output = document.querySelector('#dispatch-result');
  const agentId = document.querySelector('#dispatch-agent').value.trim();
  const path = document.querySelector('#dispatch-path').value.trim();
  let params;
  try {
    params = JSON.parse(document.querySelector('#dispatch-params').value || '{}');
  } catch {
    output.textContent = 'params 不是合法 JSON';
    return;
  }
  const res = await fetch(`/api/execution/agents/${encodeURIComponent(agentId)}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability: 'query_control_platform', input: { path, params } }),
  });
  output.textContent = JSON.stringify(await res.json(), null, 2);
  refresh();
});

setInterval(refresh, 2000);
refresh();
