import puppeteer from '@cloudflare/puppeteer';

const VERSION = '0.1.0';
const DEFAULT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const CONSEQUENTIAL = /\b(buy|purchase|place order|checkout|pay|payment|book|reserve|submit|send|publish|post|delete|remove|cancel|confirm|accept|sign|agree|transfer|withdraw|deposit|change password|reset password|close account)\b/i;
const SENSITIVE_INPUT = /password|passcode|pin|card|credit|cvv|cvc|social security|ssn|bank|routing|account number/i;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Counterpart-Browser-Key',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}

function isPrivateHost(host) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (/^(127|10)\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

function safeUrl(value) {
  let u;
  try { u = new URL(String(value || '')); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (isPrivateHost(u.hostname)) return null;
  return u;
}

function clean(value, max = 8000) {
  return String(value ?? '').trim().slice(0, max);
}

async function parseBody(request) {
  const text = await request.text();
  if (text.length > 64_000) throw new Error('Request body too large.');
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('Request body must be valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request body must be an object.');
  return body;
}

function aiText(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.response === 'string') return result.response;
  if (typeof result?.result?.response === 'string') return result.result.response;
  if (typeof result?.choices?.[0]?.message?.content === 'string') return result.choices[0].message.content;
  return '';
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  throw new Error('Planner returned invalid JSON.');
}

async function annotate(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-cp-id]').forEach(el => el.removeAttribute('data-cp-id'));
    const nodes = Array.from(document.querySelectorAll(
      'a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
    )).filter(el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 1 && r.height > 1;
    }).slice(0, 140);

    const elements = nodes.map((el, i) => {
      const id = 'cp-' + i;
      el.setAttribute('data-cp-id', id);
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      const label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        text
      ).slice(0, 180);
      return {
        id,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        label,
        href: el instanceof HTMLAnchorElement ? el.href : '',
        value: ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) ? String(el.value || '').slice(0, 100) : '',
      };
    });

    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 14000);
    return { title: document.title, url: location.href, bodyText, elements };
  });
}

async function planner(env, task, snapshot, history) {
  const system = `You are Counterpart Browser Planner.
You control a real browser by choosing exactly ONE next action.
Return ONLY one JSON object, no markdown.

Allowed actions:
{"action":"click","id":"cp-0","reason":"..."}
{"action":"type","id":"cp-0","text":"...","reason":"..."}
{"action":"select","id":"cp-0","value":"...","reason":"..."}
{"action":"navigate","url":"https://...","reason":"..."}
{"action":"wait","ms":1000,"reason":"..."}
{"action":"finish","answer":"concise answer for the user","reason":"..."}

Rules:
- Use only element ids present in the snapshot.
- Do not invent facts not visible in the snapshot/history.
- Prefer reading before clicking.
- Do not attempt purchases, payments, bookings, submissions, messages, publishing, deletions, account/security changes, or accepting legal terms. If the task reaches one of those, use finish and explain that approval is required.
- Never enter passwords, passcodes, payment data, bank data, or government identifiers.
- Stay focused on the user's task.
- Finish as soon as the requested information has been obtained.`;

  const user = JSON.stringify({ task, page: snapshot, recentHistory: history.slice(-6) });
  const result = await env.AI.run(DEFAULT_MODEL, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: 350,
    temperature: 0.1,
  });
  return parseJsonObject(aiText(result));
}

function elementById(snapshot, id) {
  return snapshot.elements.find(x => x.id === id) || null;
}

function requiresApproval(action, snapshot) {
  if (!action) return false;
  if (action.action === 'type') {
    const el = elementById(snapshot, action.id);
    if (el && SENSITIVE_INPUT.test([el.type, el.label].join(' '))) return true;
  }
  if (action.action === 'click') {
    const el = elementById(snapshot, action.id);
    if (el && CONSEQUENTIAL.test([el.label, el.href].join(' '))) return true;
  }
  return false;
}

async function execute(page, action) {
  if (!/^cp-\\d+$/.test(String(action.id || '')) && ['click','type','select'].includes(action.action)) {
    throw new Error('Planner returned an invalid element id.');
  }
  const selector = action.id ? '[data-cp-id="' + action.id + '"]' : '';

  if (action.action === 'click') {
    await page.click(selector);
    await new Promise(r => setTimeout(r, 700));
    return;
  }
  if (action.action === 'type') {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(selector, String(action.text ?? ''), { delay: 15 });
    return;
  }
  if (action.action === 'select') {
    await page.select(selector, String(action.value ?? ''));
    return;
  }
  if (action.action === 'navigate') {
    const target = safeUrl(action.url);
    if (!target) throw new Error('Planner attempted an unsafe URL.');
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 20000 });
    return;
  }
  if (action.action === 'wait') {
    await new Promise(r => setTimeout(r, Math.max(100, Math.min(Number(action.ms) || 700, 3000))));
    return;
  }
  throw new Error('Unsupported planner action.');
}

async function runTask(env, body) {
  if (String(env.BROWSER_FREE_TIER_CONFIRMED || '').toLowerCase() !== 'true') {
    return { status: 503, data: {
      error: 'Zero-cost guard is active. Cloudflare Browser Run free tier has not been confirmed for this account.',
      code: 'FREE_TIER_NOT_CONFIRMED'
    }};
  }
  if (!env.AI || !env.BROWSER) {
    return { status: 503, data: { error: 'Browser or AI binding is not configured.', code: 'MISSING_BINDING' }};
  }

  const startUrl = safeUrl(body.url);
  const task = clean(body.task, 5000);
  if (!startUrl) return { status: 400, data: { error: 'A public http(s) URL is required.' }};
  if (!task) return { status: 400, data: { error: 'A task is required.' }};

  const maxSteps = Math.max(1, Math.min(Number(body.maxSteps || env.MAX_STEPS || 10), 15));
  const maxRunMs = Math.max(10_000, Math.min(Number(env.MAX_RUN_MS || 75_000), 90_000));
  const deadline = Date.now() + maxRunMs;
  const trace = [];
  let browser;

  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(startUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 20000 });

    for (let step = 0; step < maxSteps && Date.now() < deadline; step++) {
      const snapshot = await annotate(page);
      const action = await planner(env, task, snapshot, trace);
      const record = {
        step: step + 1,
        page: { title: snapshot.title, url: snapshot.url },
        action: action.action,
        reason: clean(action.reason, 300),
      };

      if (action.action === 'finish') {
        trace.push(record);
        return { status: 200, data: {
          ok: true, version: VERSION, status: 'completed',
          answer: clean(action.answer, 8000),
          finalUrl: snapshot.url,
          pageTitle: snapshot.title,
          steps: trace,
        }};
      }

      if (requiresApproval(action, snapshot)) {
        const el = elementById(snapshot, action.id);
        trace.push({ ...record, blockedElement: el });
        return { status: 200, data: {
          ok: true, version: VERSION, status: 'approval_required',
          answer: 'The browser reached an action that can submit, purchase, send, delete, publish, change account/security settings, or enter sensitive information. It stopped before taking that action.',
          pendingAction: { ...action, element: el },
          finalUrl: snapshot.url,
          pageTitle: snapshot.title,
          steps: trace,
        }};
      }

      await execute(page, action);
      trace.push(record);
    }

    const snapshot = await annotate(page);
    const final = await planner(env, task + '\nYou have no more browser actions. Summarize the useful result now.', snapshot, trace);
    return { status: 200, data: {
      ok: true, version: VERSION, status: 'step_limit',
      answer: clean(final.answer || 'The browser reached its step/time limit before completing the task.', 8000),
      finalUrl: snapshot.url,
      pageTitle: snapshot.title,
      steps: trace,
    }};
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: json({}).headers });
    const url = new URL(request.url);

    if (request.method === 'GET' && ['/', '/health'].includes(url.pathname)) {
      return json({
        ok: true,
        service: 'Counterpart Browser Cloud',
        version: VERSION,
        browserBinding: Boolean(env.BROWSER),
        aiBinding: Boolean(env.AI),
        zeroCostGuard: true,
        freeTierConfirmed: String(env.BROWSER_FREE_TIER_CONFIRMED || '').toLowerCase() === 'true',
      });
    }

    if (url.pathname !== '/api/browser/run' || request.method !== 'POST') return json({ error: 'Not found' }, 404);

    if (!env.COUNTERPART_BROWSER_KEY) return json({ error: 'COUNTERPART_BROWSER_KEY secret is not configured.', code: 'AUTH_NOT_CONFIGURED' }, 503);
    if (request.headers.get('X-Counterpart-Browser-Key') !== env.COUNTERPART_BROWSER_KEY) return json({ error: 'Browser access key required.' }, 401);

    try {
      const body = await parseBody(request);
      const result = await runTask(env, body);
      return json(result.data, result.status);
    } catch (error) {
      return json({ error: clean(error?.message || 'Browser task failed.', 1000), code: 'BROWSER_RUN_FAILED' }, 500);
    }
  },
};
