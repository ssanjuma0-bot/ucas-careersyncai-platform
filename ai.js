async function callAiProvider(userText, systemPrompt) {
  const provider = process.env.AI_PROVIDER;
  if (!provider) {
    return { configured: false, reply: null, error: 'AI provider is not configured on the server. Set AI_PROVIDER and the matching API key environment variable.' };
  }
  try {
    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { configured: false, reply: null, error: 'AI_PROVIDER is set to gemini but GEMINI_API_KEY is missing.' };
      const model = process.env.AI_MODEL || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\nUser: ${userText}` }] }] }) });
      if (!resp.ok) return { configured: true, reply: null, error: `Gemini API returned status ${resp.status}` };
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { configured: true, reply: null, error: 'Gemini API returned an empty response.' };
      return { configured: true, reply: text, error: null };
    }
    if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { configured: false, reply: null, error: 'AI_PROVIDER is set to openai but OPENAI_API_KEY is missing.' };
      const model = process.env.AI_MODEL || 'gpt-4o-mini';
      const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }] }) });
      if (!resp.ok) return { configured: true, reply: null, error: `OpenAI-compatible API returned status ${resp.status}` };
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) return { configured: true, reply: null, error: 'AI API returned an empty response.' };
      return { configured: true, reply: text, error: null };
    }
    return { configured: false, reply: null, error: `Unknown AI_PROVIDER "${provider}". Use "gemini" or "openai".` };
  } catch (e) {
    return { configured: true, reply: null, error: 'AI provider request failed: ' + (e.message || 'network error') };
  }
}
module.exports = { callAiProvider };
