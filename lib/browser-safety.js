import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const privateV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) privateV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const privateV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
]) privateV6.addSubnet(address, prefix, 'ipv6');

export const CONSEQUENTIAL = /\b(buy|purchase|place order|checkout|pay|payment|book|reserve|submit|send|publish|post|delete|remove|cancel|confirm|accept|sign|agree|transfer|withdraw|deposit|change password|reset password|close account|log ?in|sign ?in|sign ?up|register|unsubscribe)\b/i;
export const SENSITIVE = /password|passcode|\bpin\b|card|credit|cvv|cvc|social security|\bssn\b|bank|routing|account number|api.?key|access.?token|cookie|secret/i;

export class BrowserSafetyError extends Error {
  constructor(message = 'Only public HTTP(S) targets are allowed.') {
    super(message);
    this.code = 'UNSAFE_URL';
  }
}

export function isPublicIP(address) {
  const family = isIP(address);
  if (family === 4) return !privateV4.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !privateV6.check(address, 'ipv6');
  return false;
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!host || host === 'localhost' || /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host)) return null;
    if (isIP(host) ? !isPublicIP(host) : !host.includes('.')) return null;
    return url;
  } catch { return null; }
}

export async function resolvePublicTarget(value, resolver = lookup) {
  const url = safeUrl(value);
  if (!url) throw new BrowserSafetyError();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] :
      await resolver(hostname, { all: true, verbatim: true });
  } catch { throw new BrowserSafetyError('The public target could not be resolved.'); }
  if (!addresses.length || addresses.some(x => !isPublicIP(x.address))) throw new BrowserSafetyError();
  const selected = addresses.find(x => x.family === 4) || addresses[0];
  return { url, ...selected };
}

function normal(value) {
  try { return decodeURIComponent(String(value || '')).replace(/[_+\-/]/g, ' '); }
  catch { return String(value || ''); }
}

export function protectedNavigation(value) {
  const url = safeUrl(value);
  if (!url) return true;
  return CONSEQUENTIAL.test(normal(url.pathname + ' ' + url.search)) || SENSITIVE.test(normal(url.search));
}

export function actionNeedsApproval(action, snapshot) {
  if (!action || !['click', 'type', 'select', 'navigate', 'wait', 'finish'].includes(action.action)) return true;
  if (action.action === 'navigate') return protectedNavigation(action.url);
  if (['wait', 'finish'].includes(action.action)) return false;
  const el = snapshot.elements.find(x => x.id === action.id);
  if (!el || el.disabled) return true;
  const context = [el.type, el.label, el.name, el.autocomplete, el.formPurpose].join(' ');
  if (SENSITIVE.test(context) || CONSEQUENTIAL.test(normal(el.label))) return true;
  if (action.action === 'click' && el.href) return protectedNavigation(el.href);
  // v1 permits only ordinary search fields and explicitly GET search forms.
  if (action.action === 'click') return !(el.formMethod === 'get' && /search|query|find/i.test(el.formPurpose));
  return !(/search|query|find/i.test(context) && (!el.formMethod || el.formMethod === 'get')) ||
    SENSITIVE.test(String(action.text || action.value || ''));
}

export function dedicatedService(env = process.env) {
  return env.COUNTERPART_BROWSER_SERVICE === 'dedicated-v1' &&
    env.COUNTERPART_BROWSER_PROJECT_ID === 'prj_W6UoNfPuV49vk0ywIw1hJXuCbIJL' &&
    env.VERCEL_PROJECT_ID !== 'prj_lzUulhynX4eHg96Xsys6t093IgY5' &&
    (!env.VERCEL_PROJECT_ID || env.VERCEL_PROJECT_ID === env.COUNTERPART_BROWSER_PROJECT_ID);
}

export function productionDisabled(env = process.env) {
  return env.VERCEL_ENV === 'production' && !dedicatedService(env);
}

export function createRunLimiter({ limit = 12, windowMs = 60 * 60 * 1000 } = {}) {
  let active = false;
  let starts = [];
  return {
    acquire(now = Date.now()) {
      starts = starts.filter(time => now - time < windowMs);
      if (active || starts.length >= limit) return null;
      starts.push(now);
      active = true;
      let released = false;
      return () => { if (!released) { active = false; released = true; } };
    },
  };
}
