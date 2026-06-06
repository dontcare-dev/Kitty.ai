export default async function handler(req, res) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify(req.body)
  });
  const data = await response.json();
  res.status(200).json(data);
}