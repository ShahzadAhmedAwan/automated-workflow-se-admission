import dotenv from 'dotenv';
dotenv.config({ path: 'server/.env' });

const apiKey = process.env.GEMINI_API_KEY;

const models = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest'
];

async function run() {
  for (const m of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Return JSON: {"ok": true}' }] }],
          generationConfig: { response_mime_type: 'application/json' }
        })
      });
      const text = await res.text();
      console.log(`[${m}] HTTP ${res.status}:`, text.slice(0, 100));
    } catch (err) {
      console.error(`[${m}] Failed:`, err.message);
    }
  }
}

run();
