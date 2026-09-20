import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeAI, request, MEMO, ORIGIN } from './fixtures.js';
const { default: worker } = await import(process.env.COUNTERPART_BASELINE ? '../baseline/worker-v1.1.2.js' : '../worker.js');
const env = (AI = fakeAI()) => ({ AI, CF_FREE_TIER_CONFIRMED: 'true' });

test('health and allowed preflight keep the existing API contract', async () => {
  const health = await worker.fetch(request({}, '/health', 'GET'), env());
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const preflight = await worker.fetch(request({}, '/api/team', 'OPTIONS'), env());
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});
test('smart routing produces six reports and a grounded lead memo', async () => {
  const AI = fakeAI();
  const response = await worker.fetch(request({ context: 'Project memory already exists.' }), env(AI));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.agents.length, 6);
  assert.equal(data.synthesis, MEMO);
  assert.equal(data.meta.route.mode, 'smart');
  assert.ok(data.meta.selectedAgentIds.includes('architect'));
  assert.ok(AI.calls.every(c => JSON.stringify(c.input).includes('Project memory already exists.')));
});
test('all 15 specialists and targeted review remain supported', async () => {
  const agentIds = ['inventor','engineer','researcher','redteam','business','product','architect','coder','qa','safety','manufacturing','cost','customer','security','pm'];
  const response = await worker.fetch(request({ smart: false, agentIds, deep: true }), env());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.agents.length, 15);
  assert.ok(data.review.includes('MINORITY VIEW'));
});
test('manual selection is deduplicated and invalid inputs rejected', async () => {
  const response = await worker.fetch(request({ smart: false, agentIds: ['qa', 'qa', 'invalid'] }), env());
  assert.equal((await response.json()).agents.length, 1);
  assert.equal((await worker.fetch(request({ goal: '' }), env())).status, 400);
  assert.equal((await worker.fetch(request({ smart: false, agentIds: [] }), env())).status, 400);
  assert.equal((await worker.fetch(request({}, '/api/team', 'POST', 'https://untrusted.example'), env())).status, 403);
});
test('failed specialists never become fabricated successful reports', async () => {
  const AI = fakeAI({ run: async () => { throw new Error('Model unavailable'); } });
  const response = await worker.fetch(request({ smart: false, agentIds: ['qa'] }), env(AI));
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.agents[0].content, '');
  assert.ok(data.agents[0].error);
});
