export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // CORS preflight
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

  // Add system prompt if provided
  if (system && typeof system === 'string' && system.trim()) {
    groqMessages.push({
      role: 'system',
      content: system.trim(),
    });
  }

  // Add conversation history
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;

      let role = msg.role;

      // Frontend uses 'ai', Groq requires 'assistant'
      if (role === 'ai') role = 'assistant';

      // Only valid roles
      if (!['user', 'assistant', 'system'].includes(role)) continue;

      groqMessages.push({
        role,
        content: msg.content.trim(),
      });
    }
  }

  // Must have at least one user message
  if (!groqMessages.some((m) => m.role === 'user')) {
    return new Response(JSON.stringify({ error: 'No user message provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Call Groq
  let groqRes;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to reach Groq', detail: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Read Groq response
  const text = await groqRes.text();

  // Forward status + body back to client
  return new Response(text, {
    status: groqRes.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
