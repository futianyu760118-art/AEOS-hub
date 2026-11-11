import assert from 'node:assert/strict';
import test from 'node:test';
import { digestAgentResult } from '../src/agent-result.ts';

test('extracts summary and evidence from top-level and conclusions', () => {
  const digest = digestAgentResult({
    summary: '存在缺料风险',
    evidence_refs: ['ref-a'],
    conclusions: [
      { matter: '缺料', evidence_refs: ['ref-b', 'ref-a'] },
      { matter: '延期', evidence_refs: ['ref-c'] },
    ],
    data_confidence: 'high',
  });
  assert.equal(digest.summary, '存在缺料风险');
  assert.deepEqual(digest.evidenceRefs, ['ref-a', 'ref-b', 'ref-c']);
  assert.equal(digest.dataConfidence, 'high');
  assert.equal(digest.lowConfidence, false);
});

test('marks low confidence, stale or validation-failed output for human decision', () => {
  assert.equal(digestAgentResult({ data_confidence: 'low' }).lowConfidence, true);
  assert.equal(digestAgentResult({ stale: true }).lowConfidence, true);
  const failed = digestAgentResult({ validation_note: 'missing evidence_refs' });
  assert.equal(failed.lowConfidence, true);
  assert.equal(failed.validationNote, 'missing evidence_refs');
});

test('falls back to a bounded string/JSON summary for unstructured results', () => {
  assert.equal(digestAgentResult('已完成').summary, '已完成');
  const digest = digestAgentResult({ conclusion: '结果' });
  assert.match(digest.summary, /"conclusion":"结果"/);
  assert.deepEqual(digest.evidenceRefs, []);
});
