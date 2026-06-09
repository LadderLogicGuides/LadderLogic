// api/analyze.js
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ticker } = req.body;
    if (!ticker) {
      return res.status(400).json({ error: 'Ticker is required' });
    }

    const cleanTicker = ticker.trim().toUpperCase().replace(/[^A-Z.]/g, '');

    // Get real-time price
    const quote = await getRealTimeQuote(cleanTicker);

    // Prompt for Claude
    const prompt = `You are a senior equity research analyst with 20+ years experience.

Analyze ticker: ${cleanTicker}
Current Price: ${quote.price} (${quote.change})

Return **ONLY** valid JSON. No markdown, no explanations.

Use this exact structure:
{
  "ticker": "${cleanTicker}",
  "companyName": "Full Company Name",
  "sector": "Sector Name",
  "currentPrice": "${quote.price}",
  "priceChange": "${quote.change}",
  "valuation": {
    "status": "UNDERVALUED|FAIRLY VALUED|OVERVALUED",
    "score": 1-10,
    "rationale": "2-3 sentence analysis"
  },
  "momentum": {
    "status": "OVERSOLD|NEUTRAL|OVERBOUGHT",
    "score": 1-10,
    "rationale": "2-3 sentence analysis"
  },
  "sentiment": {
    "status": "BEARISH|NEUTRAL|BULLISH",
    "score": 1-10,
    "rationale": "2-3 sentence analysis"
  },
  "riskLevel": {
    "label": "LOW|MODERATE|HIGH|VERY HIGH",
    "score": 1-10,
    "factors": "Key risk factors"
  },
  "recommendation": {
    "action": "BUY|SELL|HOLD|WATCH",
    "timeHorizon": "SHORT-TERM|LONG-TERM|BOTH",
    "confidence": 65-95,
    "summary": "4-5 sentence investment thesis"
  },
  "catalysts": [
    {"direction": "positive|negative|neutral", "text": "Catalyst description"}
  ],
  "technicalLevels": {
    "support": "Price level",
    "resistance": "Price level",
    "trend": "One sentence trend summary"
  }
}`;

    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1400,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }]
    });

    let text = completion.content[0].text;
    let parsed;

    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch (e) {
      parsed = fallbackAnalysis(cleanTicker, quote);
    }

    return res.status(200).json(parsed);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
}

// Real-time Quote
async function getRealTimeQuote(ticker) {
  try {
    if (process.env.FINNHUB_API_KEY) {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`);
      const data = await res.json();
      if (data.c) {
        const change = ((data.c - data.pc) / data.pc * 100);
        return {
          price: `$${data.c.toFixed(2)}`,
          change: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
          rawPrice: data.c
        };
      }
    }
  } catch (e) {}

  // Yahoo fallback
  try {
    const proxy = 'https://api.allorigins.win/get?url=';
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`;
    const res = await fetch(proxy + encodeURIComponent(url));
    const json = await res.json();
    const quote = JSON.parse(json.contents).quoteResponse.result[0];
    if (quote) {
      const chg = quote.regularMarketChangePercent;
      return {
        price: `$${quote.regularMarketPrice.toFixed(2)}`,
        change: `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`,
        rawPrice: quote.regularMarketPrice
      };
    }
  } catch (e) {}

  // Mock
  return {
    price: '$' + (Math.random() * 400 + 50).toFixed(2),
    change: (Math.random() > 0.5 ? '+' : '') + (Math.random() * 8 - 3).toFixed(1) + '%',
    rawPrice: 150
  };
}

function fallbackAnalysis(ticker, quote) {
  return {
    ticker,
    companyName: `${ticker} Inc.`,
    sector: "Technology",
    currentPrice: quote.price,
    priceChange: quote.change,
    valuation: { status: "FAIRLY VALUED", score: 6, rationale: "Fallback data due to API issue." },
    momentum: { status: "NEUTRAL", score: 5, rationale: "Fallback data." },
    sentiment: { status: "NEUTRAL", score: 5, rationale: "Fallback data." },
    riskLevel: { label: "MODERATE", score: 5, factors: "Fallback data." },
    recommendation: { action: "HOLD", timeHorizon: "LONG-TERM", confidence: 60, summary: "Using fallback analysis." },
    catalysts: [],
    technicalLevels: { support: "N/A", resistance: "N/A", trend: "Data unavailable" }
  };
}
