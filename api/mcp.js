import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import browserHandler from './browser-run.js';

const TOOL_NAME = 'browse_web';

function callBrowser(body) {
  return new Promise((resolve, reject) => {
    const req = {
      method: 'POST',
      body,
      query: {},
      headers: {},
    };
    const result = { statusCode: 200, headers: {} };
    const res = {
      setHeader(name, value) { result.headers[name] = value; },
      status(code) { result.statusCode = code; return this; },
      json(data) { resolve({ status: result.statusCode, data }); return this; },
      send(data) { resolve({ status: result.statusCode, data }); return this; },
    };
    Promise.resolve(browserHandler(req, res)).catch(reject);
  });
}

const mcpHandler = createMcpHandler((server) => {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Browse the public web',
      description:
        'Use a cloud browser to open a public webpage and complete a bounded, non-consequential browsing task. It can read pages, follow links, and use ordinary search/navigation controls. It stops before purchases, payments, bookings, submissions, messages, publishing, deletion, account/security changes, legal acceptance, logins, or sensitive credential entry.',
      inputSchema: z.object({
        url: z.string().url().describe('Public http(s) starting URL.'),
        task: z.string().min(1).max(4000).describe('What to find or accomplish on the website.'),
        maxSteps: z.number().int().min(1).max(7).optional().describe('Maximum browser decision steps. Defaults to 7.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, task, maxSteps }) => {
      const result = await callBrowser({ url, task, maxSteps: maxSteps || 7 });
      const data = result.data || {};
      if (result.status >= 400 || data.error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: 'Counterpart Browser could not complete the task: ' + (data.error || 'Unknown browser error.'),
          }],
          structuredContent: { ok: false, ...data },
        };
      }

      return {
        content: [{
          type: 'text',
          text: [
            data.answer || 'Browser task completed.',
            data.finalUrl ? 'Final URL: ' + data.finalUrl : '',
            data.status ? 'Status: ' + data.status : '',
          ].filter(Boolean).join('\n\n'),
        }],
        structuredContent: {
          ok: true,
          status: data.status,
          answer: data.answer,
          finalUrl: data.finalUrl,
          pageTitle: data.pageTitle,
          steps: data.steps,
          pendingAction: data.pendingAction,
        },
      };
    },
  );
}, {
  serverInfo: { name: 'Counterpart Browser Cloud', version: '0.1.0' },
  instructions:
    'Use browse_web only for bounded public-web navigation and information retrieval. Do not use it for consequential actions, authentication, private account data, or sensitive credentials.',
});

function nodeHeadersToWeb(headers) {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) {
      for (const v of value) out.append(key, String(v));
    } else if (value != null) {
      out.set(key, String(value));
    }
  }
  return out;
}

function toWebRequest(req, overrideBody) {
  const proto = req.headers?.['x-forwarded-proto'] || 'https';
  const host = req.headers?.host || process.env.VERCEL_URL || 'localhost';
  const url = new URL(req.url || '/api/mcp', proto + '://' + host);
  const method = req.method || 'POST';
  const headers = nodeHeadersToWeb(req.headers);
  let body;
  if (!['GET', 'HEAD'].includes(method)) {
    const source = overrideBody !== undefined ? overrideBody : req.body;
    body = typeof source === 'string' ? source : JSON.stringify(source ?? {});
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  return new Request(url, { method, headers, body });
}

async function sendWebResponse(webResponse, res) {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  const bytes = Buffer.from(await webResponse.arrayBuffer());
  return res.send(bytes);
}

async function protocolSmoke(req, res) {
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'counterpart-smoke', version: '1.0.0' },
    },
  };

  const initReq = new Request('https://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(initBody),
  });
  const initRes = await mcpHandler(initReq);
  const initText = await initRes.text();

  const listReq = new Request('https://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const listRes = await mcpHandler(listReq);
  const listText = await listRes.text();

  let callStatus = null;
  let callText = '';
  if (req.query?.smoke === 'call') {
    const callReq = new Request('https://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: TOOL_NAME,
          arguments: {
            url: 'https://example.com',
            task: 'Tell me the page title and what this page is for.',
            maxSteps: 2,
          },
        },
      }),
    });
    const callRes = await mcpHandler(callReq);
    callStatus = callRes.status;
    callText = await callRes.text();
  }

  const callOk = callStatus == null || (callStatus >= 200 && callStatus < 300);
  return res.status(initRes.ok && listRes.ok && callOk ? 200 : 500).json({
    ok: initRes.ok && listRes.ok && callOk,
    endpoint: '/api/mcp',
    tool: TOOL_NAME,
    initialize: { status: initRes.status, body: initText.slice(0, 2000) },
    toolsList: { status: listRes.status, body: listText.slice(0, 4000) },
    toolCall: callStatus == null ? null : { status: callStatus, body: callText.slice(0, 6000) },
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET' && ['protocol', 'call'].includes(String(req.query?.smoke || ''))) {
    if (process.env.VERCEL_ENV === 'production') {
      return res.status(403).json({ error: 'MCP smoke test is preview-only.' });
    }
    return protocolSmoke(req, res);
  }

  if (process.env.VERCEL_ENV === 'production') {
    return res.status(403).json({
      error: 'Counterpart Browser MCP is intentionally preview-only until tool verification is complete.',
      code: 'PREVIEW_ONLY',
    });
  }

  const webRequest = toWebRequest(req);
  const webResponse = await mcpHandler(webRequest);
  return sendWebResponse(webResponse, res);
}
