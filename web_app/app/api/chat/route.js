import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || ''
);

export async function POST(request) {
  try {
    const { prompt } = await request.json();
    if (!prompt) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    // 1. Update status to 'thinking'
    const statusUrl = `https://${process.env.VERCEL_URL || 'localhost:3000'}/api/status`;
    await fetch(statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'thinking', text: 'JARVIS IS THINKING...' })
    }).catch(() => {});

    // 2. Query Gemini with action-aware system prompt
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: `You are JARVIS (Just A Rather Very Intelligent System), a supremely advanced AI assistant.
You speak with a calm, authoritative, refined British accent. Be direct, composed, and slightly witty.
Address the user as "Sir" occasionally. Never use emojis or markdown.

IMPORTANT: You MUST respond in valid JSON format with exactly these fields:
{
  "response": "Your spoken text reply (under 3 sentences, optimized for text-to-speech)",
  "action": "none" or one of the action types below,
  "data": {} action-specific data object
}

Available actions:
- "play_music" with data: {"query": "song/artist name"} — when user asks to play a song or music
- "set_timer" with data: {"seconds": number, "label": "description"} — when user asks for a timer or reminder
- "open_url" with data: {"url": "full URL"} — when user asks to open a website
- "search_web" with data: {"query": "search terms"} — when user asks to search something online
- "get_weather" with data: {"city": "city name"} — when user asks about weather
- "get_time" with data: {} — when user asks for current time or date
- "tell_joke" with data: {} — when user asks for a joke or humor
- "none" with data: {} — for general conversation

Always include a friendly spoken "response" field regardless of action.
ONLY output valid JSON. No other text.`
    });

    const result = await model.generateContent(prompt);
    const rawText = result.response.text().trim();

    // 3. Parse the JSON response from Gemini
    let parsed;
    try {
      // Strip markdown code fences if Gemini wraps it
      let cleanJson = rawText;
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
      }
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      // Fallback: treat as plain text response
      parsed = { response: rawText, action: 'none', data: {} };
    }

    const responseText = parsed.response || rawText;

    // 4. Update status to 'speaking'
    await fetch(statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'speaking', text: responseText })
    }).catch(() => {});

    return NextResponse.json({
      response: responseText,
      action: parsed.action || 'none',
      data: parsed.data || {}
    }, {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error('Gemini Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
