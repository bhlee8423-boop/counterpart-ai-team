import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const VERSION = '0.3.0-vercel';
const MODEL = 'fast';
const PLANNER_PROVIDER = 'LLM7 test API';
let lastPlannerRequestAt = 0;
const CONSEQUENTIAL = /\b(buy|purchase|place order|checkout|pay|payment|book|reserve|submit|send|publish|post|delete|remove|cancel|confirm|accept|sign|agree|transfer|withdraw|deposit|change password|reset password|close account)\b/i;
const SENSITIVE = /password|passcode|pin|card|credit|cvv|cvc|social security|ssn|bank|routing|account number/i;


function clean(value, max = 8000) {
  return String(value ?? '').trim().slice(0, max);
}

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (/^(127|10)\./.test(h) || /^192\.168\./.test(h)) return true;
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
    }).slice(0, 100);

    const elements = nodes.map((el, i) => {
      const id = 'cp-' + i;
      el.setAttribute('data-cp-id', id);
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      const label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        text
      ).slice(0, 140);
      return {
        id,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        label,
        href: el instanceof HTMLAnchorElement ? el.href : '',
      };
    });

    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 9000);
    return { title: document.title, url: location.href, bodyText, elements };
  });
}

async function gatewayPlan(task, snapshot, history, forceFinish = false) {
  const system = `You are Counterpart Browser Planner.
Choose exactly ONE next browser action and return ONLY a JSON object.

Allowed:
{"action":"click","id":"cp-0","reason":"..."}
{"action":"type","id":"cp-0","text":"...","reason":"..."}
{"action":"select","id":"cp-0","value":"...","reason":"..."}
{"action":"navigate","url":"https://...","reason":"..."}
{"action":"wait","ms":1000,"reason":"..."}
{"action":"finish","answer":"concise answer","reason":"..."}

Rules:
- Use only element ids in the supplied page snapshot.
- Do not invent page facts.
- Prefer reading the current page before clicking.
- Never purchase, pay, book, submit, send, publish, delete, accept legal terms, or change account/security settings.
- Never enter passwords, passcodes, payment data, banking data, or government identifiers.
- If a consequential action would be needed, finish and say approval is required.
- Keep navigation focused on the user's stated task.
- Each browser step is costly. Do not click a link just because its label resembles a link clicked earlier.
- If history shows that a click navigated to a new URL, check whether that navigation already satisfied the requested action. If the user asked to open/follow/click something and then report or inspect the destination, FINISH on that destination before clicking anything else.
- Do not repeat the same link label on consecutive pages unless the task explicitly requires repeated navigation.
${forceFinish ? '- You have no browser actions left. You MUST choose finish and summarize only what is supported by the snapshot/history.' : '- Finish as soon as the requested information is obtained.'}`;

  const sinceLast = Date.now() - lastPlannerRequestAt;
  if (sinceLast < 1100) await new Promise(r => setTimeout(r, 1100 - sinceLast));
  lastPlannerRequestAt = Date.now();

  const apiKey = process.env.LLM7_API_KEY || 'counterpart-browser-preview-v1';
  const payload = JSON.stringify({
    model: MODEL,
    temperature: 0.1,
    max_tokens: 260,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ task, page: snapshot, recentHistory: history.slice(-5) }) }
    ]
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.llm7.io/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: payload
      });

      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('LLM7 returned a non-JSON response.'); }

      if (response.status === 429 && attempt < 2) {
        const retryAfter = Math.max(1, Math.min(Number(response.headers.get('retry-after')) || 1, 3));
        await new Promise(r => setTimeout(r, retryAfter * 1000 + 250));
        lastPlannerRequestAt = Date.now();
        continue;
      }

      if (!response.ok) {
        throw new Error(data?.error?.message || data?.error || 'LLM7 request failed (' + response.status + ').');
      }
      return parseJsonObject(data?.choices?.[0]?.message?.content || '');
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('LLM7 free test rate limit did not clear after retries.');
}

function elementById(snapshot, id) {
  return snapshot.elements.find(x => x.id === id) || null;
}

function needsApproval(action, snapshot) {
  if (!action) return true;
  if (action.action === 'type') {
    const el = elementById(snapshot, action.id);
    return Boolean(el && SENSITIVE.test([el.type, el.label].join(' ')));
  }
  if (action.action === 'click') {
    const el = elementById(snapshot, action.id);
    return Boolean(el && CONSEQUENTIAL.test([el.label, el.href].join(' ')));
  }
  return false;
}

function mustFinishAfterNavigation(task, trace, snapshot) {
  const last = trace.at(-1);
  if (!last || last.action !== 'click') return false;
  const previousUrl = last.page?.url || last.url || '';
  if (!previousUrl || previousUrl === snapshot.url) return false;

  const t = String(task || '').toLowerCase();
  return (
    /\b(exactly once|one time|only once)\b/.test(t) ||
    /\bafter\b.{0,80}\b(destination|page|link)\b/.test(t) ||
    /\bthen\b.{0,80}\b(stop|tell|report|summari[sz]e|show|give)\b/.test(t)
  );
}

async function execute(page, action) {
  if (['click','type','select'].includes(action.action) && !/^cp-\d+$/.test(String(action.id || ''))) {
    throw new Error('Planner returned an invalid element id.');
  }
  const selector = action.id ? '[data-cp-id="' + action.id + '"]' : '';

  if (action.action === 'click') {
    await page.click(selector);
    await new Promise(r => setTimeout(r, 600));
    return;
  }
  if (action.action === 'type') {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(selector, String(action.text ?? ''), { delay: 10 });
    return;
  }
  if (action.action === 'select') {
    await page.select(selector, String(action.value ?? ''));
    return;
  }
  if (action.action === 'navigate') {
    const target = safeUrl(action.url);
    if (!target) throw new Error('Planner attempted an unsafe URL.');
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 12000 });
    return;
  }
  if (action.action === 'wait') {
    await new Promise(r => setTimeout(r, Math.max(100, Math.min(Number(action.ms) || 500, 2000))));
    return;
  }
  throw new Error('Unsupported browser action.');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (req.query?.smoke === 'full') {
      if (process.env.VERCEL_ENV === 'production') {
        return res.status(403).json({ error: 'Smoke test is preview-only.' });
      }
      let browser;
      try {
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
          args: chromium.args,
          defaultViewport: { width: 1280, height: 800 },
          executablePath,
          headless: true,
        });
        const page = await browser.newPage();
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 12000 });
        const snapshot = await annotate(page);
        const action = await gatewayPlan(
          'Tell me the page title and what this page is for.',
          snapshot,
          [],
          true
        );
        return res.status(200).json({
          ok: true,
          smoke: 'full',
          chromium: true,
          planner: true,
          plannerProvider: PLANNER_PROVIDER,
          pageTitle: snapshot.title,
          pageUrl: snapshot.url,
          plannerAction: action.action,
          answer: clean(action.answer, 2000),
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          smoke: 'full',
          error: clean(error?.message || 'Smoke test failed.', 1000),
        });
      } finally {
        if (browser) {
          try { await browser.close(); } catch {}
        }
      }
    }

    if (req.query?.smoke === 'interact') {
      if (process.env.VERCEL_ENV === 'production') {
        return res.status(403).json({ error: 'Smoke test is preview-only.' });
      }
      let browser;
      try {
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
          args: chromium.args,
          defaultViewport: { width: 1280, height: 800 },
          executablePath,
          headless: true,
        });
        const page = await browser.newPage();
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 12000 });
        const task = 'Click the Learn more link exactly once. After that destination loads, stop browsing and tell me the destination page title and URL.';
        const trace = [];

        for (let step = 0; step < 3; step++) {
          const snapshot = await annotate(page);
          if (mustFinishAfterNavigation(task, trace, snapshot)) {
            const final = await gatewayPlan(task, snapshot, trace, true);
            return res.status(200).json({
              ok: true,
              smoke: 'interact',
              chromium: true,
              planner: true,
              interaction: true,
              plannerProvider: PLANNER_PROVIDER,
              finalUrl: snapshot.url,
              pageTitle: snapshot.title,
              answer: clean(final.answer || ('Reached ' + snapshot.title + ' at ' + snapshot.url), 2000),
              steps: trace.concat([{ step: step + 1, action: 'finish', reason: 'Explicit post-navigation stop enforced.', url: snapshot.url }]),
              guard: 'explicit-post-navigation-stop',
            });
          }
          const action = await gatewayPlan(task, snapshot, trace, false);
          const target = elementById(snapshot, action.id);
          trace.push({
            step: step + 1,
            action: action.action,
            reason: clean(action.reason, 240),
            url: snapshot.url,
            target: target ? { label: clean(target.label, 140), href: clean(target.href, 500) } : null,
          });

          if (action.action === 'finish') {
            return res.status(200).json({
              ok: snapshot.url !== 'https://example.com/',
              smoke: 'interact',
              chromium: true,
              planner: true,
              interaction: snapshot.url !== 'https://example.com/',
              plannerProvider: PLANNER_PROVIDER,
              finalUrl: snapshot.url,
              pageTitle: snapshot.title,
              answer: clean(action.answer, 2000),
              steps: trace,
            });
          }
          if (needsApproval(action, snapshot)) throw new Error('Smoke planner unexpectedly requested a protected action.');
          await execute(page, action);
        }

        const snapshot = await annotate(page);
        const final = await gatewayPlan(task, snapshot, trace, true);
        return res.status(200).json({
          ok: snapshot.url !== 'https://example.com/',
          smoke: 'interact',
          chromium: true,
          planner: true,
          interaction: snapshot.url !== 'https://example.com/',
          plannerProvider: PLANNER_PROVIDER,
          finalUrl: snapshot.url,
          pageTitle: snapshot.title,
          answer: clean(final.answer, 2000),
          steps: trace,
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          smoke: 'interact',
          error: clean(error?.message || 'Interaction smoke test failed.', 1000),
        });
      } finally {
        if (browser) {
          try { await browser.close(); } catch {}
        }
      }
    }

    return res.status(200).json({
      ok: true,
      service: 'Counterpart Browser Cloud',
      version: VERSION,
      runtime: 'Vercel Chromium + LLM7 test planner',
      model: MODEL,
      previewOnly: true,
      plannerProvider: PLANNER_PROVIDER,
      plannerAuthMode: process.env.LLM7_API_KEY ? 'free-token' : 'test-key',
      freeTokenConfigured: Boolean(process.env.LLM7_API_KEY),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.VERCEL_ENV === 'production') {
    return res.status(403).json({
      error: 'Counterpart Browser Cloud is intentionally disabled in production during preview testing.',
      code: 'PREVIEW_ONLY'
    });
  }

  const startUrl = safeUrl(req.body?.url);
  const task = clean(req.body?.task, 4000);
  if (!startUrl || !task) return res.status(400).json({ error: 'A public http(s) URL and task are required.' });

  const maxSteps = Math.max(1, Math.min(Number(req.body?.maxSteps || 7), 10));
  const trace = [];
  let browser;

  try {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 800 },
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.goto(startUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 12000 });

    for (let step = 0; step < maxSteps; step++) {
      const snapshot = await annotate(page);
      if (mustFinishAfterNavigation(task, trace, snapshot)) {
        const final = await gatewayPlan(task, snapshot, trace, true);
        trace.push({
          step: step + 1,
          page: { title: snapshot.title, url: snapshot.url },
          action: 'finish',
          reason: 'Explicit post-navigation stop enforced.',
          target: null,
        });
        return res.status(200).json({
          ok: true, version: VERSION, status: 'completed',
          answer: clean(final.answer || ('Reached ' + snapshot.title + ' at ' + snapshot.url), 6000),
          finalUrl: snapshot.url,
          pageTitle: snapshot.title,
          steps: trace,
          guard: 'explicit-post-navigation-stop',
        });
      }
      const action = await gatewayPlan(task, snapshot, trace, false);
      const target = elementById(snapshot, action.id);
      const record = {
        step: step + 1,
        page: { title: snapshot.title, url: snapshot.url },
        action: action.action,
        reason: clean(action.reason, 240),
        target: target ? { label: clean(target.label, 140), href: clean(target.href, 500) } : null,
      };

      if (action.action === 'finish') {
        trace.push(record);
        return res.status(200).json({
          ok: true, version: VERSION, status: 'completed',
          answer: clean(action.answer, 6000),
          finalUrl: snapshot.url,
          pageTitle: snapshot.title,
          steps: trace,
        });
      }

      if (action.action === 'click' && record.target?.label) {
        const normalized = record.target.label.toLowerCase().replace(/\s+/g, ' ').trim();
        const repeated = trace.slice(-2).some(prev =>
          prev.action === 'click' &&
          prev.target?.label &&
          prev.target.label.toLowerCase().replace(/\s+/g, ' ').trim() === normalized &&
          prev.page?.url !== snapshot.url
        );
        if (repeated) {
          const final = await gatewayPlan(
            task + '\nA repeated-link safety guard stopped another click. Summarize the useful result from the current page now.',
            snapshot,
            trace,
            true
          );
          trace.push({ ...record, action: 'finish', reason: 'Repeated-link navigation guard.' });
          return res.status(200).json({
            ok: true, version: VERSION, status: 'completed',
            answer: clean(final.answer || 'The requested navigation reached this page, and the repeated-link guard stopped further browsing.', 6000),
            finalUrl: snapshot.url,
            pageTitle: snapshot.title,
            steps: trace,
            guard: 'repeated-link',
          });
        }
      }

      if (needsApproval(action, snapshot)) {
        const el = elementById(snapshot, action.id);
        trace.push({ ...record, blockedElement: el });
        return res.status(200).json({
          ok: true, version: VERSION, status: 'approval_required',
          answer: 'The browser stopped before a consequential or sensitive action.',
          pendingAction: { ...action, element: el },
          finalUrl: snapshot.url,
          pageTitle: snapshot.title,
          steps: trace,
        });
      }

      await execute(page, action);
      trace.push(record);
    }

    const snapshot = await annotate(page);
    const final = await gatewayPlan(task, snapshot, trace, true);
    return res.status(200).json({
      ok: true, version: VERSION, status: 'step_limit',
      answer: clean(final.answer || 'The browser reached its step limit.', 6000),
      finalUrl: snapshot.url,
      pageTitle: snapshot.title,
      steps: trace,
    });
  } catch (error) {
    console.error('Counterpart Browser error:', error);
    return res.status(500).json({
      error: clean(error?.message || 'Browser task failed.', 800),
      code: 'BROWSER_RUN_FAILED',
    });
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
