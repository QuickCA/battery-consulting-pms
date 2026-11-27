/* Free-AI intake proxy for battery-consulting-pms.
   Uses the Cloudflare Workers AI binding (no OpenAI key, no secrets in browser).
   Free Workers plan includes 10,000 Neurons/day; default model is GLM-4.7-Flash. */

const DEFAULT_ALLOWED_ORIGIN = 'https://quickca.github.io';
const DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash';

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

function extractContent(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.response === 'string') return result.response;
  if (typeof result.result === 'string') return result.result;
  const choices = result.choices;
  if (Array.isArray(choices) && choices.length) {
    const first = choices[0];
    if (first && first.message && typeof first.message.content === 'string') return first.message.content;
    if (first && typeof first.text === 'string') return first.text;
    if (typeof first === 'string') return first;
  }
  return '';
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
    if (!env.AI || typeof env.AI.run !== 'function') {
      return json({ error: 'ai_binding_missing' }, 500, headers);
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
      : (env.OPENAI_MODEL || env.MODEL || DEFAULT_MODEL);
    const temperature = typeof payload.temperature === 'number'
      ? payload.temperature
      : 0.2;

    try {
      const result = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: temperature,
        max_tokens: 4096,
        response_format: { type: 'json_object' }
      });

      const content = extractContent(result);
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
