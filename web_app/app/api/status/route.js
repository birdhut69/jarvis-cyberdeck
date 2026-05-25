import { NextResponse } from 'next/server';

// In-memory status store (persists within active Vercel serverless instances)
let jarvisState = {
  status: 'idle', // idle, thinking, speaking, trigger_listening
  text: 'JARVIS STANDBY',
  waveform: [10, 10, 10, 10, 10, 10, 10, 10],
  ip: '0.0.0.0',
  rssi: -100,
  page: 2
};

export async function GET() {
  // If speaking, randomize the waveform slightly to simulate a pulsing audio spectrum
  if (jarvisState.status === 'speaking') {
    jarvisState.waveform = Array.from({ length: 8 }, () => Math.floor(Math.random() * 35) + 10);
  } else {
    jarvisState.waveform = [10, 10, 10, 10, 10, 10, 10, 10];
  }

  // Clear trigger state after it's read so it doesn't double trigger
  const responseData = { ...jarvisState };
  if (jarvisState.status === 'trigger_listening') {
    jarvisState.status = 'idle';
  }

  return NextResponse.json(responseData, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body.status) jarvisState.status = body.status;
    if (body.text) jarvisState.text = body.text;
    if (body.waveform) jarvisState.waveform = body.waveform;
    if (body.ip) jarvisState.ip = body.ip;
    if (body.rssi !== undefined) jarvisState.rssi = body.rssi;
    if (body.page !== undefined) jarvisState.page = body.page;

    return NextResponse.json(jarvisState, {
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, max-age=0'
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

// Enable CORS OPTIONS request
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
