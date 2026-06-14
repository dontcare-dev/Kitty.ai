export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { model, messages, system } = body;

  // Build Groq messages array
  const groqMessages = [];

  if (system && typeof system === 'string' && system.trim()) {
    groqMessages.push({ role: 'system', content: system.trim() });
  }

  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;
      let role = msg.role === 'ai' ? 'assistant' : msg.role;
      if (!['user', 'assistant', 'system'].includes(role)) continue;
      groqMessages.push({ role, content: msg.content.trim() });
    }
  }

  if (!groqMessages.some((m) => m.role === 'user')) {
    return new Response(JSON.stringify({ error: 'No user message provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // API key rotation — tries each key until one works
  const apiKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ].filter(Boolean); // removes undefined keys

  if (apiKeys.length === 0) {
    return new Response(JSON.stringify({ error: 'No API keys configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  let lastError = 'Unknown error';
  let lastStatus = 500;

  for (const apiKey of apiKeys) {
    let groqRes;
    try {
      groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'llama-3.3-70b-versatile',
          messages: groqMessages,
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
    } catch (err) {
      lastError = err.message;
      continue; // try next key
    }

    const text = await groqRes.text();

    // Rate limited or daily limit hit — try next key
    if (groqRes.status === 429) {
      lastStatus = 429;
      try {
        const j = JSON.parse(text);
        lastError = j?.error?.message || 'Rate limit reached';
      } catch {
        lastError = 'Rate limit reached';
      }
      continue; // try next key
    }

    // Any other error — return immediately, no point trying other keys
    if (!groqRes.ok) {
      return new Response(text, {
        status: groqRes.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Success
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // All keys exhausted
  return new Response(
    JSON.stringify({ error: `All API keys rate limited. ${lastError}` }),
    {
      status: lastStatus,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    }
  );
}
