// netlify/functions/analyze.js
// Runs on Netlify's Node 18 servers. API key never reaches the browser.

const https = require('https');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function callAnthropic(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: messages,
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

exports.handler = async function (event, context) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
    };
  }

  // Check API key is configured
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Server misconfiguration: ANTHROPIC_API_KEY environment variable is missing. Set it in Netlify → Site configuration → Environment variables.',
      }),
    };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON in request body.' }),
    };
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Request body must include a messages array.' }),
    };
  }

  // Call Anthropic
  try {
    const response = await callAnthropic(apiKey, body.messages);

    if (response.statusCode !== 200) {
      let errMsg = `Anthropic API returned ${response.statusCode}`;
      try {
        const parsed = JSON.parse(response.body);
        errMsg = parsed.error?.message || errMsg;
      } catch {}
      return {
        statusCode: response.statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: errMsg }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: response.body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Failed to reach Anthropic API: ${err.message}` }),
    };
  }
};
