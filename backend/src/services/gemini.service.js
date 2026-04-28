const config = require('../../config');

async function callGeminiText(prompt) {
  if (!config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  const resp = await fetch(`${config.GEMINI_API_URL}?key=${encodeURIComponent(config.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });
  if (!resp.ok) {
    throw new Error(`Gemini API error: ${resp.status}`);
  }
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

module.exports = { callGeminiText };
