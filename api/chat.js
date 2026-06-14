export const config = {
  runtime: 'edge',
};

// Verified active Groq models (as of 2025)
const MODEL_CHAIN = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'gemma2-9b-it',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function callGroq(model, groqMessages, stream) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: groqMessages,
      max_tokens: 1024,
      temperature: 0.7,
      stream: !!stream,
    }),
  });
  return res;
}

export default async function handler(req) {
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

    // Sanitize messages — remove empty or invalid entries
    const cleanMessages = (Array.isArray(messages) ? messages : [])
      .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content.trim() }));

    // Build final message array — system goes first as a user/assistant turn
    // to avoid issues with models that don't support system role
    const groqMessages = [];
    if (system && system.trim()) {
      groqMessages.push({ role: 'system', content: system.trim() });
    }
    groqMessages.push(...cleanMessages);

    // Must have at least one message
    if (groqMessages.length === 0 || !groqMessages.some(m => m.role === 'user')) {
      return new Response(
        JSON.stringify({ error: 'No valid user message provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    // Build fallback chain
    const requested = model || 'llama-3.3-70b-versatile';
    const fallbacks = [requested, ...MODEL_CHAIN.filter(m => m !== requested)];

    let lastError = 'Unknown error';
    let lastStatus = 500;

    for (const tryModel of fallbacks) {
      let groqRes;
      try {
        groqRes = await callGroq(tryModel, groqMessages, stream);
      } catch (fetchErr) {
        lastError = fetchErr.message;
        continue;
      }

      // Rate limited — try next
      if (groqRes.status === 429 || groqRes.status === 503) {
        lastStatus = groqRes.status;
        lastError = `${tryModel} rate limited (${groqRes.status})`;
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // Bad request on this model — try next (model might not exist)
      if (groqRes.status === 400) {
        const errJson = await groqRes.json().catch(() => ({}));
        lastStatus = 400;
        lastError = errJson?.error?.message || `Bad request on ${tryModel}`;
        continue;
      }

      // Other error — return it
      if (!groqRes.ok) {
        const errText = await groqRes.text();
        return new Response(
          JSON.stringify({ error: `Groq error (${groqRes.status})`, detail: errText }),
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
      data._modelUsed = tryModel;
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Model-Used': tryModel, ...CORS },
      });
    }

    // All models failed
    return new Response(
      JSON.stringify({
        error: 'All models unavailable. Please try again in a moment.',
        detail: lastError,
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
