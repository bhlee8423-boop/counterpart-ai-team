import http from 'node:http';
import net from 'node:net';
import { resolvePublicTarget } from './browser-safety.js';

// Resolve before connecting and dial the validated IP, so redirects, subresources,
// IPv6 literals, and DNS rebinding cannot reach a private network through Chromium.
export async function createPublicWebProxy() {
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(15000, () => socket.destroy());
    return socket;
  };
  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
    try {
      const target = await resolvePublicTarget(req.url);
      if (target.url.protocol !== 'http:') throw new Error('Use CONNECT for HTTPS.');
      const headers = { ...req.headers, host: target.url.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request({
        hostname: target.address, family: target.family, port: 80,
        path: target.url.pathname + target.url.search,
        method: req.method, headers, timeout: 12000,
      }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('socket', track);
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.on('aborted', () => upstream.destroy());
      upstream.end();
    } catch { res.writeHead(403).end(); }
  });
  server.on('connection', track);
  server.on('connect', async (req, client, head) => {
    try {
      const target = await resolvePublicTarget('https://' + req.url);
      if (client.destroyed) return;
      const upstream = track(net.connect({ host: target.address, family: target.family, port: 443 }));
      client.on('close', () => upstream.destroy());
      upstream.on('connect', () => {
        if (client.destroyed) { upstream.destroy(); return; }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
    } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    }),
  };
}
