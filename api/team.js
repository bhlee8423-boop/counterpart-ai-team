const BACKEND = 'https://counterpart-ai-backend.blee12384.workers.dev/api/team';

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body ?? {});

    const headers = { 'Content-Type': 'application/json' };
    const accessKey = request.headers['x-counterpart-key'];
    if (accessKey) headers['X-Counterpart-Key'] = accessKey;

    const upstream = await fetch(BACKEND, {
      method: 'POST',
      headers,
      body
    });

    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    return response.send(text);
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(502).json({
      error: 'Counterpart backend proxy failed',
      detail: String(error && error.message ? error.message : error)
    });
  }
};
