export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const { model, messages, system, stream } = body;

  // Build Groq messages
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
    return new Response(
      JSON.stringify({ error: 'No user message provided' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const apiKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No API keys configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const groqPayload = {
    model: model || 'llama-3.3-70b-versatile',
    messages: groqMessages,
    temperature: 0.7,
    max_tokens: 1024,
  };
  if (stream) groqPayload.stream = true;

  let lastError = 'Unknown error';
  let lastStatus = 500;

  for (const apiKey of apiKeys) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(groqPayload),
      });

      // Success
      if (groqRes.ok) {
        if (stream) {
          // Pass through the raw stream
          return new Response(groqRes.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              ...corsHeaders,
            },
          });
        } else {
          const data = await groqRes.json();
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // Rate limited - try next key
      if (groqRes.status === 429) {
        const errorText = await groqRes.text();
        try {
          const j = JSON.parse(errorText);
          lastError = j?.error?.message || 'Rate limit reached';
        } catch {
          lastError = 'Rate limit reached';
        }
        lastStatus = 429;
        continue; // Try next key
      }

      // Other error - return immediately
      const errorText = await groqRes.text();
      return new Response(errorText, {
        status: groqRes.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      lastError = err.message;
      continue; // Network error, try next key
    }
  }

  // All keys exhausted
  return new Response(
    JSON.stringify({ error: `All API keys failed. ${lastError}` }),
    { status: lastStatus, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}