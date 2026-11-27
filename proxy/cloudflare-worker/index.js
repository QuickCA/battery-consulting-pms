/* ChatGPT intake proxy for battery-consulting-pms.
   The OpenAI API key lives only in the Worker secret OPENAI_API_KEY.
   Deployed URL is placed into the front-end config.js as CHATGPT_PROXY_URL. */

const DEFAULT_ALLOWED_ORIGIN = 'https://quickca.github.io';
const DEFAULT_MODEL = 'gpt-5.5';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN)
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (allowed.indexOf('*') !== -1) headers['Access-Control-Allow-Origin'] = '*';
  else if (origin && allowed.indexOf(origin) !== -1) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {});
  return new Response(JSON.stringify(data), { status: status || 200, headers: h });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: headers });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, headers);
    }
    if (!headers['Access-Control-Allow-Origin']) {
      return json({ error: 'origin_not_allowed' }, 403, headers);
    }
    if (!env.OPENAI_API_KEY) {
      return json({ error: 'missing_api_key' }, 500, headers);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: 'invalid_json' }, 400, headers);
    }

    const system = typeof payload.system === 'string' ? payload.system : '';
    const user = typeof payload.user === 'string' ? payload.user : '';
    if (!system || !user) {
      return json({ error: 'missing_messages' }, 400, headers);
    }

    const model = typeof payload.model === 'string' && payload.model
      ? payload.model
      : (env.OPENAI_MODEL || DEFAULT_MODEL);
    const temperature = typeof payload.temperature === 'number'
      ? payload.temperature
      : 0.2;

    try {
      const upstream = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.OPENAI_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          temperature: temperature,
          response_format: { type: 'json_object' }
        })
      });

      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { raw: text.slice(0, 1000) };
      }

      if (!upstream.ok) {
        return json({
          error: 'openai_error',
          status: upstream.status,
          message: data && data.error && data.error.message ? data.error.message : 'request_failed'
        }, upstream.status, headers);
      }

      const content = data && data.choices && data.choices[0] &&
        data.choices[0].message && data.choices[0].message.content;
      if (!content) {
        return json({ error: 'empty_completion' }, 502, headers);
      }

      return json({ content: content }, 200, headers);
    } catch (e) {
      return json({
        error: 'proxy_error',
        message: String((e && e.message) || e)
      }, 502, headers);
    }
  }
};
