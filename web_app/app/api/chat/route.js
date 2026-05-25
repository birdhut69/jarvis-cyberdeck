import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

// Initialize the Google Gemini API client
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

    // 2. Query Google Gemini AI (Free Model gemini-2.5-flash)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are JARVIS, a highly advanced, supportive cyberdeck AI assistant. Speak concisely, with a professional, slightly British cyberpunk persona. Keep responses under 3 sentences.'
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // 3. Update status to 'speaking' with the response text
    await fetch(statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'speaking', text: responseText })
    }).catch(() => {});

    return NextResponse.json({ response: responseText }, {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error('Gemini Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
