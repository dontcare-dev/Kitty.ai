export const config = {
  runtime: 'edge',
};

// Fallback model chain — if primary hits rate limit, try next
const MODEL_CHAIN = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama3-70b-8192',
  'mixtral-8x7b-32768',
  'llama3-8b-8192',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function callGroq(model, groqMessages, stream, maxTokens) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: groqMessages,
      max_tokens: maxTokens,
      temperature: 0.7,
      stream: !!stream,
    }),
  });
  return res;
}

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  try {
    const body = await req.json();
    const { model, messages, system, stream } = body;

    // Build message array
    const groqMessages = [];
    if (system) groqMessages.push({ role: 'system', content: system });
    if (Array.isArray(messages)) groqMessages.push(...messages);

    const maxTokens = stream ? 2048 : 1024;

    // Build model fallback list — requested model first, then defaults
    const requested = model || 'llama-3.3-70b-versatile';
    const fallbacks = [requested, ...MODEL_CHAIN.filter(m => m !== requested)];

    let lastError = null;
    let lastStatus = 500;

    for (const tryModel of fallbacks) {
      let groqRes;
      try {
        groqRes = await callGroq(tryModel, groqMessages, stream, maxTokens);
      } catch (fetchErr) {
        lastError = fetchErr.message;
        continue;
      }

      // Rate limited or overloaded — try next model
      if (groqRes.status === 429 || groqRes.status === 503) {
        lastStatus = groqRes.status;
        const retryAfter = groqRes.headers.get('retry-after');
        lastError = `Model ${tryModel} rate limited (${groqRes.status})${retryAfter ? `, retry after ${retryAfter}s` : ''}`;
        // Small delay before trying next model
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // Other Groq error — return immediately
      if (!groqRes.ok) {
        const errText = await groqRes.text();
        return new Response(
          JSON.stringify({ error: `Groq error (${groqRes.status})`, detail: errText, model: tryModel }),
          { status: groqRes.status, headers: { 'Content-Type': 'application/json', ...CORS } }
        );
      }

      // Success — streaming
      if (stream) {
        return new Response(groqRes.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Model-Used': tryModel,
            ...CORS,
          },
        });
      }

      // Success — JSON
      const data = await groqRes.json();
      // Inject which model was actually used
      data._modelUsed = tryModel;
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Model-Used': tryModel, ...CORS },
      });
    }

    // All models exhausted
    return new Response(
      JSON.stringify({
        error: 'All models are currently rate limited. Please wait a moment and try again.',
        detail: lastError,
        retryAfter: 10,
      }),
      { status: lastStatus, headers: { 'Content-Type': 'application/json', ...CORS } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
}
