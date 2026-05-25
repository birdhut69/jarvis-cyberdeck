import { NextResponse } from 'next/server';

// Search for a YouTube video and return the embed-ready video ID
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  
  if (!query) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  try {
    // Use Piped API (free YouTube frontend) to search for videos
    const res = await fetch(
      `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=music_songs`,
      { headers: { 'User-Agent': 'JARVIS/1.0' } }
    );
    
    if (!res.ok) {
      // Fallback: try videos filter
      const res2 = await fetch(
        `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=videos`,
        { headers: { 'User-Agent': 'JARVIS/1.0' } }
      );
      const data2 = await res2.json();
      const items = data2.items || [];
      if (items.length > 0) {
        const videoId = items[0].url?.replace('/watch?v=', '') || '';
        return NextResponse.json({ videoId, title: items[0].title || query });
      }
      return NextResponse.json({ error: 'No results found' }, { status: 404 });
    }

    const data = await res.json();
    const items = data.items || [];
    
    if (items.length > 0) {
      const videoId = items[0].url?.replace('/watch?v=', '') || '';
      return NextResponse.json({ 
        videoId, 
        title: items[0].title || query,
        thumbnail: items[0].thumbnail || ''
      });
    }

    return NextResponse.json({ error: 'No results found' }, { status: 404 });
  } catch (error) {
    console.error('Music search error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
