import { NextResponse } from 'next/server';

// Reuse status from status route or hit an API endpoint
export async function POST() {
  try {
    // Notify the status route that the physical button was pressed
    // In serverless, we send an internal POST to update status
    const statusUrl = `https://${process.env.VERCEL_URL || 'localhost:3000'}/api/status`;
    await fetch(statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'trigger_listening',
        text: 'ESP32 BUTTON PRESSED - LISTENING...'
      })
    }).catch(() => {});

    return NextResponse.json({ success: true }, {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
