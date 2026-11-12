import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { M13AgentApplicationApi } from '../src/m13-agent-application-api.ts';

const API_KEY = 'test-m13-secret';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-m13-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const evidence: unknown[] = [];
  const api = new M13AgentApplicationApi({
    apiKey: API_KEY,
    appendEvidence: (entry) => { evidence.push(entry); return entry; },
    storeFile: join(dir, 'm13-agent-applications.json'),
    submitRatePerMinute: 1000,
  });
  return { api, evidence };
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return {
    source_system: 'M05-CRM',
    applicant: '朱剑军',
    contact: 'zjj@example.com',
    request_type: 'agent_chat_access',
    purpose: '在销售场景内调用 M13 Agent 能力',
    agent_ids: ['agent-sales'],
    ...overrides,
  };
}

test('POST 提交申请返回 201 与 application_id', async () => {
  const { api, evidence } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  assert.equal(res?.status, 201);
  const body = res!.body as { application_id: string; status: string; source_system: string };
  assert.match(body.application_id, /^app_/);
  assert.equal(body.status, 'submitted');
  assert.equal(body.source_system, 'M05-CRM');
  assert.equal(evidence.length, 1);
});

test('必填字段缺失返回 400', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: { applicant: 'x', purpose: 'y' } });
  assert.equal(res?.status, 400);
});

test('GET 按 id 查询返回状态', async () => {
  const { api } = fixture({ after: () => {} });
  const created = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  const id = (created!.body as { application_id: string }).application_id;
  const res = await api.handle({ method: 'GET', pathname: `/poms/v1/agent-applications/${id}` });
  assert.equal(res?.status, 200);
  assert.equal((res!.body as { status: string }).status, 'submitted');
});

test('未知 id 返回 404', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agent-applications/app_nope' });
  assert.equal(res?.status, 404);
});

test('Idempotency-Key 重复提交返回同一申请', async () => {
  const { api } = fixture({ after: () => {} });
  const first = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody({ idempotency_key: 'k-1' }) });
  const second = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody({ idempotency_key: 'k-1' }) });
  const id1 = (first!.body as { application_id: string }).application_id;
  const id2 = (second!.body as { application_id: string }).application_id;
  assert.equal(id1, id2);
  assert.equal(second?.status, 200);
});

test('台账列表无密钥返回 401', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agent-applications' });
  assert.equal(res?.status, 401);
});

test('台账列表带密钥返回 200', async () => {
  const { api } = fixture({ after: () => {} });
  await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agent-applications', apiKey: API_KEY });
  assert.equal(res?.status, 200);
  const applications = (res!.body as { applications: unknown[] }).applications;
  assert.equal(applications.length, 1);
});

test('提交路径不在前缀内返回 null', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents/health' });
  assert.equal(res, null);
});

test('审核通过签发凭据，GET /{id} 返回 credential 与 activation', async () => {
  const { api } = fixture({ after: () => {} });
  const created = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  const id = (created!.body as { application_id: string }).application_id;

  const review = await api.handle({ method: 'PATCH', pathname: `/poms/v1/agent-applications/${id}`, apiKey: API_KEY, body: { status: 'approved' } });
  assert.equal(review?.status, 200);
  const reviewed = review!.body as { status: string; credential: { api_key: string; issued_at: string } | null; activation: unknown };
  assert.equal(reviewed.status, 'approved');
  assert.match(reviewed.credential!.api_key, /^m13_/);
  assert.ok(reviewed.activation);

  const got = await api.handle({ method: 'GET', pathname: `/poms/v1/agent-applications/${id}` });
  const body = got!.body as { credential: { api_key: string } | null };
  assert.ok(body.credential);
});

test('审核签发密钥可被 verifyCredential 接受', async () => {
  const { api } = fixture({ after: () => {} });
  const created = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  const id = (created!.body as { application_id: string }).application_id;
  const review = await api.handle({ method: 'PATCH', pathname: `/poms/v1/agent-applications/${id}`, apiKey: API_KEY, body: { status: 'approved' } });
  const issued = (review!.body as { credential: { api_key: string } }).credential.api_key;
  assert.equal(api.verifyCredential(issued), true);
  assert.equal(api.verifyCredential(API_KEY), true);
  assert.equal(api.verifyCredential('not-a-key'), false);
});

test('审核拒绝返回 rejected', async () => {
  const { api } = fixture({ after: () => {} });
  const created = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  const id = (created!.body as { application_id: string }).application_id;
  const review = await api.handle({ method: 'PATCH', pathname: `/poms/v1/agent-applications/${id}`, apiKey: API_KEY, body: { status: 'rejected', reviewer_note: '资料不全' } });
  assert.equal(review?.status, 200);
  assert.equal((review!.body as { status: string }).status, 'rejected');
});

test('审核无密钥返回 401', async () => {
  const { api } = fixture({ after: () => {} });
  const created = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  const id = (created!.body as { application_id: string }).application_id;
  const review = await api.handle({ method: 'PATCH', pathname: `/poms/v1/agent-applications/${id}`, body: { status: 'approved' } });
  assert.equal(review?.status, 401);
});

test('重复审核返回 409', async () => {
  const { api } = fixture({ after: () => {} });
  const created = await api.handle({ method: 'POST', pathname: '/poms/v1/agent-applications', body: submitBody() });
  const id = (created!.body as { application_id: string }).application_id;
  await api.handle({ method: 'PATCH', pathname: `/poms/v1/agent-applications/${id}`, apiKey: API_KEY, body: { status: 'approved' } });
  const again = await api.handle({ method: 'PATCH', pathname: `/poms/v1/agent-applications/${id}`, apiKey: API_KEY, body: { status: 'rejected' } });
  assert.equal(again?.status, 409);
});
