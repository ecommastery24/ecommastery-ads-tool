const DAILY_LIMIT = 5;
const ADMIN_CODE = 'ecommastery2024';

async function redisCommand(...args) {
  const url = process.env.UPSTASH_REDIS_KV_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Redis not configured');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const data = await res.json();
  return data.result;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { system, messages, adminCode } = req.body;
    const isAdmin = adminCode && adminCode === ADMIN_CODE;

    if (!isAdmin) {
      const ip = getClientIp(req);
      const key = `limit:${ip}:${getTodayStr()}`;

      let current = 0;
      try {
        current = parseInt(await redisCommand('GET', key)) || 0;
      } catch (e) {
        // Si Redis falla, dejamos pasar para no romper la herramienta
        current = 0;
      }

      if (current >= DAILY_LIMIT) {
        return res.status(429).json({
          error: `Alcanzaste tu límite de ${DAILY_LIMIT} generaciones diarias. Vuelve mañana 🔄`
        });
      }

      try {
        const newVal = await redisCommand('INCR', key);
        if (newVal === 1) {
          await redisCommand('EXPIRE', key, 90000);
        }
      } catch (e) {
        // Continuar aunque falle el incremento
      }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system,
        messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
