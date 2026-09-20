// Provider-neutral, request-scoped foundation. No product or RECKON dependency.
export const FEDERATION_VERSION = '1.2.0-rc.2';
const CAPABILITIES = ['analysis', 'coding', 'review', 'synthesis'];
const PROVIDERS = ['cloudflare', 'openai', 'anthropic', 'google'];
const KEYS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY' };
const enabled = value => value === true || value === 'true';
const boundedInt = (value, fallback, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;

export class FederationError extends Error {
  constructor(code, message, attempts = []) { super(message); this.code = code; this.attempts = attempts; }
}

export function createRegistry(env) {
  const defaults = [
    ['cf-qwen', '@cf/qwen/qwen3-30b-a3b-fp8', 'Qwen3 30B', 'qwen', 32768],
    ['cf-llama', '@cf/meta/llama-3.1-8b-instruct-fp8', 'Llama 3.1 8B FP8', 'llama', 32000],
    ['cf-mistral', '@cf/mistralai/mistral-small-3.1-24b-instruct', 'Mistral Small 3.1', 'mistral', 128000],
    ['cf-gemma', '@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B', 'gemma', 256000],
  ].map(([id, model, label, family, contextWindowTokens]) => ({
    id, model, label, family, contextWindowTokens,
    provider: 'cloudflare', capabilities: CAPABILITIES, cost: 'free', enabled: true,
  }));
  let configured = [];
  if (env.FEDERATION_MODELS_JSON) {
    try { configured = JSON.parse(env.FEDERATION_MODELS_JSON); }
    catch { throw new FederationError('CONFIG', 'FEDERATION_MODELS_JSON must be valid JSON.'); }
    if (!Array.isArray(configured) || configured.length > 24) throw new FederationError('CONFIG', 'Configure at most 24 model records.');
  }
  const records = new Map(defaults.map(m => [m.id, m]));
  for (const item of configured) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new FederationError('CONFIG', 'Invalid model record.');
    if (records.has(item.id) && item.enabled === false && Object.keys(item).length === 2) {
      records.set(item.id, { ...records.get(item.id), enabled: false }); continue;
    }
    // Explicit allowlist: no arbitrary URL, credential field, or extra provider parameters.
    const m = { id: item.id, model: item.model, label: item.label || item.model,
      family: item.family, provider: item.provider, capabilities: item.capabilities,
      cost: item.cost || 'unknown', enabled: item.enabled !== false,
      contextWindowTokens: item.contextWindowTokens };
    if (![m.id, m.model, m.label, m.family].every(v => typeof v === 'string' && v.length > 0 && v.length <= 160)
      || !/^[a-z0-9_-]+$/.test(m.id) || !/^[a-z0-9_.-]+$/.test(m.family)
      || !PROVIDERS.includes(m.provider) || !['free', 'paid', 'unknown'].includes(m.cost)
      || !Array.isArray(m.capabilities) || !m.capabilities.length || !m.capabilities.every(c => CAPABILITIES.includes(c))
      || !Number.isInteger(m.contextWindowTokens) || m.contextWindowTokens < 2048 || m.contextWindowTokens > 2000000
      || (m.provider === 'cloudflare' && !m.model.startsWith('@cf/'))
      || (m.provider === 'google' && !/^[a-zA-Z0-9._-]+$/.test(m.model))) {
      throw new FederationError('CONFIG', 'Invalid model registry fields. Check the documented schema.');
    }
    if (m.cost === 'free' && !['cloudflare', 'google'].includes(m.provider)) {
      throw new FederationError('CONFIG', 'This foundation supports verified free tiers only for Cloudflare and Google.');
    }
    // One provider/model is one registry identity, even if aliases have different labels.
    if ([...records.values()].some(existing => existing.id !== m.id && existing.provider === m.provider && existing.model === m.model)) {
      throw new FederationError('CONFIG', 'Duplicate provider/model registration.');
    }
    records.set(m.id, m);
  }
  return [...records.values()].map(m => {
    let blockedReason = null;
    if (!m.enabled) blockedReason = 'disabled';
    else if (m.provider === 'cloudflare' ? !env.AI?.run : !env[KEYS[m.provider]]) blockedReason = 'missing-credential-or-binding';
    else if (m.cost === 'unknown') blockedReason = 'unknown-cost';
    else if (m.cost === 'free' && !enabled(env[m.provider === 'cloudflare' ? 'CF_FREE_TIER_CONFIRMED' : 'GOOGLE_FREE_TIER_CONFIRMED'])) blockedReason = 'free-tier-not-confirmed';
    else if (m.cost === 'paid' && (!enabled(env.FEDERATION_ALLOW_PAID) || !env.COUNTERPART_API_KEY || boundedInt(env.FEDERATION_MAX_PAID_CALLS, 0, 0, 12) === 0)) blockedReason = 'paid-routing-disabled';
    return Object.freeze({ ...m, capabilities: Object.freeze([...m.capabilities]), available: !blockedReason, blockedReason });
  });
}

export function createRuntime(env, transport = fetch) {
  return {
    env, transport, registry: createRegistry(env), familyUses: new Map(), providerUses: new Map(),
    blockedProviders: new Set(), blockedModels: new Set(), calls: 0, paidCalls: 0, attempts: [],
    maxCalls: boundedInt(env.FEDERATION_MAX_CALLS, 48, 4, 64),
    maxPaidCalls: boundedInt(env.FEDERATION_MAX_PAID_CALLS, 0, 0, 12),
    maxAttempts: 3, concurrency: boundedInt(env.FEDERATION_CONCURRENCY, 4, 1, 6),
    timeoutMs: boundedInt(env.FEDERATION_TIMEOUT_MS, 25000, 50, 45000),
    deadline: Date.now() + boundedInt(env.FEDERATION_RUN_TIMEOUT_MS, 120000, 100, 180000),
  };
}

export function rankModels(runtime, spec = {}) {
  const required = spec.capabilities || ['analysis'];
  const inputBytes = new TextEncoder().encode(`${spec.system || ''}\n${spec.user || ''}`).length;
  return runtime.registry.filter(m => m.available && !runtime.blockedModels.has(m.id)
    && !runtime.blockedProviders.has(m.provider) && !(spec.excludeIds || []).includes(m.id)
    && required.every(c => m.capabilities.includes(c))
    // Byte count is a conservative context guard, not a claimed token measurement.
    && inputBytes + (spec.maxTokens || 520) + 512 <= m.contextWindowTokens
    && (m.cost !== 'paid' || runtime.paidCalls < runtime.maxPaidCalls))
    .sort((a, b) => {
      const score = m => (runtime.familyUses.get(m.family) || 0) * 4
        + (runtime.providerUses.get(m.provider) || 0) * 2
        + ((spec.avoidFamilies || []).includes(m.family) ? 10 : 0)
        + ((spec.avoidProviders || []).includes(m.provider) ? 6 : 0)
        - (m.model === spec.preferredModel ? 1 : 0);
      // Cost eligibility always precedes diversity. Paid providers cannot displace a free candidate.
      return Number(a.cost === 'paid') - Number(b.cost === 'paid') || score(a) - score(b) || a.id.localeCompare(b.id);
    });
}

function reserve(runtime, model) {
  runtime.familyUses.set(model.family, (runtime.familyUses.get(model.family) || 0) + 1);
  runtime.providerUses.set(model.provider, (runtime.providerUses.get(model.provider) || 0) + 1);
}

export function planModels(runtime, specs) {
  return specs.map(spec => {
    const model = rankModels(runtime, spec)[0];
    if (model) reserve(runtime, model);
    return { ...spec, plannedId: model?.id || null };
  });
}

export function visibleText(result, provider) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  if (provider === 'openai') return (result.output || []).filter(x => x.type === 'message')
    .flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text || '').join('\n');
  if (provider === 'anthropic') return (result.content || []).filter(x => x.type === 'text').map(x => x.text || '').join('\n');
  if (provider === 'google') return (result.candidates?.[0]?.content?.parts || []).filter(x => !x.thought).map(x => x.text || '').join('\n');
  const content = result.choices?.[0]?.message?.content;
  if (Array.isArray(content)) return content.filter(x => x.type === 'text').map(x => x.text || '').join('\n');
  return typeof content === 'string' ? content : (result.response || result.result?.response || result.text || '');
}

function publicError(error) {
  if (error instanceof FederationError) return error;
  const status = Number(error?.status || error?.statusCode);
  const message = String(error?.message || '');
  if (status === 429 || /quota|rate.?limit|neurons|exceed.*limit/i.test(message)) return new FederationError('QUOTA', 'Provider quota or rate limit reached.');
  if ([401, 403].includes(status)) return new FederationError('AUTH', 'Provider authentication was rejected.');
  if (status === 404 || /model.*not found|unknown model/i.test(message)) return new FederationError('MODEL', 'Configured model is unavailable.');
  return new FederationError('PROVIDER', 'Provider request failed.'); // Never echo provider bodies or secrets.
}

async function invoke(runtime, model, spec, signal) {
  const maxTokens = spec.maxTokens || 520;
  if (model.provider === 'cloudflare') {
    const input = { messages: [{ role: 'system', content: spec.system }, { role: 'user', content: spec.user }],
      max_tokens: maxTokens, temperature: spec.temperature ?? 0.35 };
    if (model.family === 'qwen') { input.repetition_penalty = 1.12; input.frequency_penalty = 0.2; }
    return runtime.env.AI.run(model.model, input);
  }
  let url, headers, body;
  if (model.provider === 'openai') {
    url = 'https://api.openai.com/v1/responses';
    headers = { Authorization: `Bearer ${runtime.env.OPENAI_API_KEY}` };
    body = { model: model.model, instructions: spec.system, input: spec.user, max_output_tokens: maxTokens, store: false };
  } else if (model.provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'x-api-key': runtime.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
    body = { model: model.model, system: spec.system, messages: [{ role: 'user', content: spec.user }], max_tokens: maxTokens };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent`;
    headers = { 'x-goog-api-key': runtime.env.GOOGLE_API_KEY };
    body = { systemInstruction: { parts: [{ text: spec.system }] }, contents: [{ role: 'user', parts: [{ text: spec.user }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: spec.temperature ?? 0.35 } };
  }
  const response = await runtime.transport(url, { method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!response.ok) throw publicError({ status: response.status });
  const result = await response.json();
  if (result.status === 'incomplete' || result.status === 'failed'
    || result.stop_reason === 'max_tokens' || result.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    throw new FederationError('INCOMPLETE', 'Provider output was incomplete.');
  }
  return result;
}

function usageOf(result, provider) {
  const usage = result?.usage || result?.usageMetadata || {};
  const valid = n => Number.isFinite(n) && n >= 0 ? n : null;
  return { source: 'provider-reported-or-unavailable',
    inputTokens: valid(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount),
    outputTokens: valid(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount),
    totalTokens: valid(usage.total_tokens ?? usage.totalTokenCount), provider };
}

export async function runFederated(runtime, spec) {
  const attempts = [];
  const attempted = new Set();
  for (let index = 0; index < runtime.maxAttempts; index++) {
    if (runtime.calls >= runtime.maxCalls || Date.now() >= runtime.deadline) break;
    const candidates = rankModels(runtime, { ...spec, excludeIds: [...(spec.excludeIds || []), ...attempted] });
    const planned = index === 0 && candidates.find(m => m.id === spec.plannedId);
    // A previously planned paid call must still yield to any newly eligible free candidate.
    const model = planned && (planned.cost !== 'paid' || candidates[0]?.cost === 'paid') ? planned : candidates[0];
    if (!model) break;
    if (model.id !== spec.plannedId) reserve(runtime, model);
    attempted.add(model.id);
    runtime.calls++;
    if (model.cost === 'paid') runtime.paidCalls++;
    const started = Date.now();
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        invoke(runtime, model, spec, controller.signal),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new FederationError('TIMEOUT', 'Provider response timed out.'));
        }, Math.min(runtime.timeoutMs, runtime.deadline - Date.now())); })
      ]);
      if (result?.choices?.[0]?.finish_reason === 'length') {
        throw new FederationError('INCOMPLETE', 'Provider output was incomplete.');
      }
      const raw = visibleText(result, model.provider);
      if (typeof raw !== 'string') throw new FederationError('EMPTY', 'Provider returned no usable text.');
      const text = raw.replace(/<(think|analysis)>[\s\S]*?<\/\1>/gi, '').replace(/<(think|analysis)>[\s\S]*$/gi, '').trim();
      if (!text || text.length > 16000) throw new FederationError('EMPTY', 'Provider returned no usable bounded text.');
      if (spec.validate && !spec.validate(text)) throw new FederationError('QUALITY', 'Output did not pass the required format or grounding checks.');
      const attempt = { registryId: model.id, provider: model.provider, modelId: model.model, family: model.family,
        status: 'success', durationMs: Date.now() - started };
      attempts.push(attempt); runtime.attempts.push(attempt);
      return { text, model: model.label, provenance: { registryId: model.id, provider: model.provider,
        modelId: model.model, reportedModelId: typeof result?.model === 'string' ? result.model : null,
        family: model.family, costTier: model.cost, startedAt: new Date(started).toISOString(),
        completedAt: new Date().toISOString(), fallbackUsed: attempts.length > 1 || Boolean(spec.plannedId && model.id !== spec.plannedId),
        attempts, usage: usageOf(result, model.provider) } };
    } catch (rawError) {
      const error = publicError(rawError);
      const attempt = { registryId: model.id, provider: model.provider, modelId: model.model, family: model.family,
        status: 'failed', code: error.code, durationMs: Date.now() - started,
        ...(error.code === 'TIMEOUT' && model.provider === 'cloudflare' ? { cancellationConfirmed: false } : {}) };
      attempts.push(attempt); runtime.attempts.push(attempt);
      if (['QUOTA', 'AUTH', 'TIMEOUT'].includes(error.code)) runtime.blockedProviders.add(model.provider);
      if (['MODEL', 'PROVIDER'].includes(error.code)) runtime.blockedModels.add(model.id);
    } finally { clearTimeout(timer); }
  }
  throw new FederationError('NO_RESULT', 'No eligible model completed this request within the configured limits.', attempts);
}

export async function mapSettledLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await fn(items[index], index) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }));
  return results;
}

export function auditDiversity(reports) {
  const successful = reports.filter(r => r.content && r.provenance);
  const families = {}, providers = {};
  for (const report of successful) {
    families[report.provenance.family] = (families[report.provenance.family] || 0) + 1;
    providers[report.provenance.provider] = (providers[report.provenance.provider] || 0) + 1;
  }
  const duplicatePairs = [];
  const tokens = text => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  for (let i = 0; i < successful.length; i++) for (let j = i + 1; j < successful.length; j++) {
    const a = tokens(successful[i].content), b = tokens(successful[j].content);
    const common = [...a].filter(word => b.has(word)).length;
    if (a.size >= 30 && b.size >= 30 && common / (a.size + b.size - common) >= 0.9) duplicatePairs.push([successful[i].id, successful[j].id]);
  }
  const warnings = [];
  if (successful.length < reports.length) warnings.push('Some selected specialists did not return a usable report.');
  if (Object.keys(providers).length < 2) warnings.push('This run used one serving provider.');
  if (Object.keys(families).length < 2) warnings.push('This run used one model family; multiple roles do not establish independent agreement.');
  if (duplicatePairs.length) warnings.push('Some reports have very similar wording; review them for repeated arguments.');
  return { families, providers, modelFamilies: Object.keys(families).length, servingProviders: Object.keys(providers).length,
    duplicatePairs, warnings, independence: 'Blind first pass enforced. Family counts and text similarity are proxies, not proof of cognitive independence.' };
}

export async function lockFirstPass(reports) {
  const serialized = JSON.stringify(reports);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return { algorithm: 'SHA-256', digest: [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join(''),
    lockedAt: new Date().toISOString(), scope: 'Immutable response snapshot before review; no durable server ledger.' };
}

export function freezeSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}
