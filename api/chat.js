export const config = {
  runtime: 'edge',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
    const { model, messages, system } = body;

    // Build messages — NO streaming, keep it simple
    const groqMessages = [];

    if (system && system.trim()) {
      groqMessages.push({ role: 'system', content: system.trim() });
    }

    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (!m || !m.content || !m.content.trim()) continue;
        // Fix role: frontend sends 'ai', Groq expects 'assistant'
        const role = m.role === 'ai' ? 'assistant' : m.role;
        if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
        groqMessages.push({ role, content: m.content.trim() });
      }
    }

    // Safety check
    if (!groqMessages.some(m => m.role === 'user')) {
      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages: groqMessages,
        max_tokens: 1024,
        temperature: 0.7,
        stream: false, // NO streaming — most reliable
      }),
    });

    const responseText = await groqRes.text();

    if (!groqRes.ok) {
      return new Response(
        JSON.stringify({
          error: `Server error (${groqRes.status})`,
          detail: responseText,
        }),
        { status: groqRes.status, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    // Return raw text as JSON
    return new Response(responseText, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
}
