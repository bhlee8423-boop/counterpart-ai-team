import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker, { findMemoryContradictions } from '../worker.js';
import { createRegistry, createRuntime, rankModels, planModels, runFederated, visibleText, auditDiversity } from '../federation.js';
import { fakeAI, request, MEMO } from './fixtures.js';

const caps = ['analysis','coding','review','synthesis'];
const extra = (provider, cost = 'paid', overrides = {}) => ({
  id: `${provider}-test`, provider, model: `${provider}-model`, label: `${provider} test model`,
  family: `${provider}-family`, capabilities: caps, cost, contextWindowTokens: 200000, ...overrides,
});
const freeEnv = (overrides = {}) => ({ AI: fakeAI(), CF_FREE_TIER_CONFIRMED: 'true', ...overrides });
const spec = (overrides = {}) => ({ system: 'Independent analyst', user: 'Explain the risks.', maxTokens: 300, ...overrides });

test('unconfirmed free tiers, unknown cost and paid configuration fail closed', () => {
  assert.ok(createRegistry({ AI: fakeAI() }).every(m => !m.available));
  const registry = createRegistry(freeEnv({ OPENAI_API_KEY: 'mock-secret', FEDERATION_MODELS_JSON: JSON.stringify([extra('openai')]) }));
  assert.equal(registry.find(m => m.provider === 'openai').blockedReason, 'paid-routing-disabled');
  assert.throws(() => createRegistry({ FEDERATION_MODELS_JSON: '{broken' }), /valid JSON/);
  assert.throws(() => createRegistry({ FEDERATION_MODELS_JSON: JSON.stringify([extra('openai','free')]) }), /verified free tiers/);
});

test('registry rejects alias duplication and separates capabilities from role preferences', () => {
  assert.throws(() => createRegistry({ FEDERATION_MODELS_JSON: JSON.stringify([extra('cloudflare','free', { model:'@cf/qwen/qwen3-30b-a3b-fp8' })]) }), /Duplicate/);
  const runtime = createRuntime(freeEnv({ GOOGLE_API_KEY: 'mock', GOOGLE_FREE_TIER_CONFIRMED: 'true', FEDERATION_MODELS_JSON: JSON.stringify([extra('google','free',{capabilities:['analysis']})]) }));
  assert.ok(rankModels(runtime, spec({capabilities:['coding']})).every(m => m.provider !== 'google'));
  assert.equal(rankModels(runtime, spec({capabilities:['vision']})).length, 0);
  assert.equal(rankModels(runtime, spec({user:'x'.repeat(300000)})).length, 0);
});

test('planned assignments distribute families and serving providers without buying diversity', () => {
  const runtime = createRuntime(freeEnv({ GOOGLE_API_KEY:'mock', GOOGLE_FREE_TIER_CONFIRMED:'true',
    OPENAI_API_KEY:'mock', COUNTERPART_API_KEY:'mock-owner', FEDERATION_ALLOW_PAID:'true', FEDERATION_MAX_PAID_CALLS:'2',
    FEDERATION_MODELS_JSON: JSON.stringify([extra('google','free'),extra('openai')]) }));
  const planned = planModels(runtime, Array.from({length:6},()=>spec()));
  const models = planned.map(p => runtime.registry.find(m=>m.id===p.plannedId));
  assert.ok(new Set(models.map(m=>m.family)).size>=4);
  assert.equal(new Set(models.map(m=>m.provider)).size,2);
  assert.ok(models.every(m=>m.cost==='free'));
});

test('provider-native payloads and visible response parsers use official endpoint contracts', async t => {
  for (const provider of ['openai','anthropic','google']) await t.test(provider, async () => {
    const env = { [`${provider === 'anthropic' ? 'ANTHROPIC' : provider.toUpperCase()}_API_KEY`]:'mock-secret',
      COUNTERPART_API_KEY:'mock-owner', FEDERATION_ALLOW_PAID:'true', FEDERATION_MAX_PAID_CALLS:'2',
      FEDERATION_MODELS_JSON: JSON.stringify([extra(provider)]) };
    let observed;
    const response = provider === 'openai' ? { output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:'Visible response'}]}], usage:{input_tokens:12,output_tokens:3} }
      : provider === 'anthropic' ? {content:[{type:'thinking',thinking:'Hidden'},{type:'text',text:'Visible response'}],usage:{input_tokens:12,output_tokens:3}}
      : {candidates:[{content:{parts:[{thought:true,text:'Hidden'},{text:'Visible response'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:3}};
    const runtime=createRuntime(env, async(url,options)=>{observed={url,...options,body:JSON.parse(options.body)};return Response.json(response);});
    const result=await runFederated(runtime,spec());
    assert.equal(result.text,'Visible response');
    assert.equal(result.provenance.provider,provider);
    assert.equal(result.provenance.usage.inputTokens,12);
    assert.equal(observed.redirect,'error');
    assert.equal(observed.url.includes('mock-secret'),false);
    if(provider==='openai'){assert.equal(observed.url,'https://api.openai.com/v1/responses');assert.equal(observed.body.store,false);assert.equal(observed.body.max_output_tokens,300);}
    if(provider==='anthropic'){assert.equal(observed.body.system,'Independent analyst');assert.equal(observed.headers['anthropic-version'],'2023-06-01');}
    if(provider==='google'){assert.equal(observed.body.systemInstruction.parts[0].text,'Independent analyst');assert.equal(observed.body.generationConfig.maxOutputTokens,300);}
  });
  assert.equal(visibleText({choices:[{message:{content:'CF chat'}}]},'cloudflare'),'CF chat');
  assert.equal(visibleText({result:{response:'CF nested'}},'cloudflare'),'CF nested');
});

test('specialist fallback reports the actual model and sanitizes upstream error messages', async () => {
  let calls=0;
  const runtime=createRuntime(freeEnv({AI:fakeAI({run:async()=>{if(calls++===0)throw new Error('leaked secret SHOULD_NOT_APPEAR');return {response:'Useful fallback response'};}})}));
  const planned=planModels(runtime,[spec()])[0];
  const result=await runFederated(runtime,planned);
  assert.notEqual(result.provenance.registryId,planned.plannedId);
  assert.equal(result.provenance.fallbackUsed,true);
  assert.equal(result.provenance.attempts.length,2);
  assert.equal(JSON.stringify(result).includes('SHOULD_NOT_APPEAR'),false);
});

test('quota failure opens a request-local provider circuit and cannot fall into paid models by default', async () => {
  const AI=fakeAI({run:async()=>{const e=new Error('quota exhausted');e.status=429;throw e;}});
  let externalCalls=0;
  const runtime=createRuntime(freeEnv({AI,OPENAI_API_KEY:'mock',FEDERATION_MODELS_JSON:JSON.stringify([extra('openai')])}),async()=>{externalCalls++;throw new Error('must not call');});
  await assert.rejects(()=>runFederated(runtime,spec()));
  await assert.rejects(()=>runFederated(runtime,spec()));
  assert.equal(AI.calls.length,1);
  assert.equal(externalCalls,0);
  assert.equal(runtime.paidCalls,0);
});

test('free-provider quota exhaustion can fall back to another verified free provider', async () => {
  const AI=fakeAI({run:async()=>{throw Object.assign(new Error('quota'),{status:429});}});
  const runtime=createRuntime(freeEnv({AI,GOOGLE_API_KEY:'mock',GOOGLE_FREE_TIER_CONFIRMED:'true',FEDERATION_MODELS_JSON:JSON.stringify([extra('google','free')])}),async()=>Response.json({candidates:[{content:{parts:[{text:'Google fallback'}]},finishReason:'STOP'}]}));
  const result=await runFederated(runtime,spec({preferredModel:'@cf/qwen/qwen3-30b-a3b-fp8'}));
  assert.equal(result.provenance.provider,'google');
  assert.equal(result.provenance.attempts[0].code,'QUOTA');
  assert.equal(runtime.paidCalls,0);
});

test('timeouts are bounded and unabortable Cloudflare calls do not trigger more calls to that provider', async () => {
  const runtime=createRuntime(freeEnv({FEDERATION_TIMEOUT_MS:'50',AI:fakeAI({run:()=>new Promise(()=>{})})}));
  await assert.rejects(()=>runFederated(runtime,spec()),e=>e.attempts[0].code==='TIMEOUT'&&e.attempts[0].cancellationConfirmed===false);
  assert.equal(runtime.calls,1);
});

test('concurrent paid attempts respect the server cap even when requests fail', async () => {
  const runtime=createRuntime({OPENAI_API_KEY:'mock',COUNTERPART_API_KEY:'owner',FEDERATION_ALLOW_PAID:'true',FEDERATION_MAX_PAID_CALLS:'2',
    FEDERATION_MODELS_JSON:JSON.stringify([extra('openai')])},async()=>new Response('',{status:500}));
  await Promise.allSettled(Array.from({length:8},()=>runFederated(runtime,spec())));
  assert.equal(runtime.paidCalls,2);
  assert.equal(runtime.calls,2);
});

test('blind reports complete before review; checkpoint exactly matches returned reports and concurrency is bounded', async () => {
  const agentIds=['inventor','engineer','researcher','redteam','business','product'];
  let active=0,peak=0,completed=0;
  const AI=fakeAI({run:async(model,input)=>{
    const system=input.messages[0].content;
    if(/Targeted Review|Lead/.test(system)){
      assert.equal(completed,6);
      return {response:/Lead/.test(system)?MEMO:'Material disagreement remains. Minority objection: burden.'};
    }
    assert.equal(input.messages[1].content.includes('PRIVATE_REPORT_'),false);
    active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,5)); active--;completed++;
    return {response:`STATUS: ANSWERED\nPRIVATE_REPORT_${completed} ${system}`};
  }});
  const response=await worker.fetch(request({smart:false,agentIds,deep:true}),freeEnv({AI,FEDERATION_CONCURRENCY:'2'}));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(peak,2);
  assert.equal(data.meta.firstPass.digest,createHash('sha256').update(JSON.stringify(data.agents)).digest('hex'));
  assert.ok(data.meta.diversity.modelFamilies>=3);
  assert.equal(data.meta.diversity.servingProviders,1);
  assert.ok(data.meta.warnings.includes('This run used one serving provider.'));
  assert.notEqual(data.meta.reviewProvenance.family,data.meta.leadProvenance.family);
});

test('abstention and minority opinions reach review and synthesis without forced agreement', async () => {
  const AI=fakeAI({run:async(model,input)=>{
    if(/Targeted Review|Lead/.test(input.messages[0].content)){
      assert.ok(input.messages[1].content.includes('ABSTAINED'));
      return {response:/Lead/.test(input.messages[0].content)?MEMO:'The analyst abstained; the minority objection remains unresolved.'};
    }
    return {response:'STATUS: ABSTAINED\nThe evidence is insufficient. Minority objection: operating burden is unknown.'};
  }});
  const data=await (await worker.fetch(request({smart:false,agentIds:['qa'],deep:true}),freeEnv({AI}))).json();
  assert.equal(data.agents[0].status,'abstained');
  assert.deepEqual(data.meta.abstentions,['qa']);
});

test('bad lead structure triggers model fallback; repeated bad output is blocked', async () => {
  let leads=0;
  const AI=fakeAI({run:async(model,input)=>({response:/Lead/.test(input.messages[0].content)?(++leads===1?'bad':MEMO):'STATUS: ANSWERED\nKeep the minority objection.'})});
  const data=await (await worker.fetch(request({smart:false,agentIds:['qa']}),freeEnv({AI}))).json();
  assert.equal(data.meta.leadFallbackUsed,true);
  assert.equal(data.synthesis,MEMO);
  const bad=fakeAI({run:async()=>({response:'bad'})});
  assert.equal((await worker.fetch(request({smart:false,agentIds:['qa']}),freeEnv({AI:bad}))).status,502);
});

test('memory guard distinguishes missing capabilities from existing ones and permits hardening', () => {
  assert.equal(findMemoryContradictions('No authentication exists.','Implement authentication.').length,0);
  assert.equal(findMemoryContradictions('Authentication already exists.','Implement authentication.').length,1);
  assert.equal(findMemoryContradictions('Authentication already exists.','Add regression tests to harden existing authentication.').length,0);
});

test('memory contradiction triggers a bounded grounding repair while preserving the report checkpoint', async () => {
  const AI=fakeAI({run:async(model,input)=>{
    const system=input.messages[0].content;
    if(/grounding repair Lead/.test(system))return {response:MEMO};
    if(/Lead/.test(system))return {response:MEMO.replace('Keep the project focused on a small, reversible pilot with explicit acceptance criteria.','Build project memory. Then run a bounded pilot with explicit acceptance criteria.')};
    return {response:'STATUS: ANSWERED\nProject memory already exists. Improve the pilot acceptance criteria.'};
  }});
  const response=await worker.fetch(request({context:'Project memory already exists.',smart:false,agentIds:['qa']}),freeEnv({AI}));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.meta.memoryRewriteUsed,true);
  assert.equal(data.meta.leadHistory.length,2);
  assert.equal(data.synthesis,MEMO);
  assert.equal(data.meta.firstPass.digest,createHash('sha256').update(JSON.stringify(data.agents)).digest('hex'));
});

test('Cloudflare token-limit truncation is rejected before fallback text is accepted', async () => {
  let calls=0;
  const runtime=createRuntime(freeEnv({AI:fakeAI({run:async()=>++calls===1
    ? {choices:[{message:{content:'Truncated answer'},finish_reason:'length'}]}
    : {choices:[{message:{content:'Complete fallback answer'},finish_reason:'stop'}]}})}));
  const result=await runFederated(runtime,spec());
  assert.equal(result.text,'Complete fallback answer');
  assert.equal(result.provenance.attempts[0].code,'INCOMPLETE');
});

test('API rejects malformed/oversized memory, honors owner auth and never accepts client billing overrides', async () => {
  const malformed=new Request('https://counterpart.test/api/team',{method:'POST',body:'{broken'});
  assert.equal((await worker.fetch(malformed,freeEnv())).status,400);
  assert.equal((await worker.fetch(request({context:'x'.repeat(12001)}),freeEnv())).status,400);
  assert.equal((await worker.fetch(request({deep:'false'}),freeEnv())).status,400);
  assert.equal((await worker.fetch(request(),freeEnv({COUNTERPART_API_KEY:'owner'}))).status,401);
  assert.equal((await worker.fetch(request({CF_FREE_TIER_CONFIRMED:true,allowPaid:true}),{AI:fakeAI()})).status,503);
  const r=request();r.headers.set('X-Counterpart-Key','owner');
  assert.equal((await worker.fetch(r,freeEnv({COUNTERPART_API_KEY:'owner'}))).status,200);
});

test('near-identical reports are flagged without claiming statistical independence', () => {
  const text=Array.from({length:45},(_,i)=>`word${i}`).join(' ');
  const audit=auditDiversity(['a','b'].map(id=>({id,content:text,provenance:{family:'same',provider:'same'}})));
  assert.deepEqual(audit.duplicatePairs,[['a','b']]);
  assert.match(audit.independence,/not proof/);
});
