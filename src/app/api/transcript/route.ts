import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import https from 'https';

const geminiKey = process.env.GEMINI_KEY as string;
const proxyUrl = process.env.HTTP_PROXY || process.env.PROXY_URL;
const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

interface TranscriptEntry {
  offset: number;
  duration: number;
  text: string;
}

// Configure axios with proxy if available
const axiosInstance = axios.create({
  httpsAgent: proxyUrl ? new https.Agent({
    proxy: {
      host: new URL(proxyUrl).hostname,
      port: parseInt(new URL(proxyUrl).port),
      protocol: new URL(proxyUrl).protocol.replace(':', '')
    }
  }) : undefined
});

// Custom YouTube transcript fetcher with proxy support
async function fetchTranscriptWithProxy(videoId: string): Promise<TranscriptEntry[]> {
  if (!proxyUrl) {
    // If no proxy set, use the default library
    return YoutubeTranscript.fetchTranscript(videoId);
  }

  try {
    // First attempt to get video info to check availability
    const videoInfoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    await axiosInstance.get(videoInfoUrl);

    // Then get the transcript data
    const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`;
    const response = await axiosInstance.get(transcriptUrl);
    
    // Parse the response to extract transcript
    if (!response.data) {
      throw new Error('Could not get transcripts for this video');
    }
    
    // Process the XML response to extract text
    const transcriptEntries = parseYouTubeTranscriptXml(response.data);
    
    return transcriptEntries;
  } catch (error) {
    console.error('Error fetching transcript with proxy:', error);
    // Fall back to the library method if proxy fails
    return YoutubeTranscript.fetchTranscript(videoId);
  }
}

// Helper function to parse YouTube transcript XML
function parseYouTubeTranscriptXml(xmlData: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  
  // Basic regex to extract text from simplified XML format
  const regex = /<text start="([\d.]+)" dur="([\d.]+)">(.*?)<\/text>/g;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(xmlData)) !== null) {
    entries.push({
      offset: parseFloat(match[1]) * 1000, // Convert to milliseconds
      duration: parseFloat(match[2]) * 1000, // Convert to milliseconds
      text: decodeURIComponent(match[3].replace(/\+/g, ' '))
    });
  }
  
  return entries;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get('videoId');

  if (!videoId) {
    return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
  }

  try {
    console.log(`Fetching transcript for video: ${videoId} ${proxyUrl ? 'using proxy' : ''}`);
    
    const transcript: TranscriptEntry[] = await fetchTranscriptWithProxy(videoId);
    
    if (!transcript || transcript.length === 0) {
      return NextResponse.json({ error: 'No transcript available' }, { status: 404 });
    }
    
    const transcriptText = transcript.map(entry => entry.text).join(" ");
    
    const prompt = `
      You are an advanced AI designed to interpret video transcripts and generate detailed summaries. 
      Do not use any markdown syntax; instead, write headings plainly, e.g., "Introduction".
      
      Task Instructions:
      - Review the video transcript.
      - Craft a 4-5 paragraph summary including purpose, highlights, and insights.
      
      Transcript: ${transcriptText}
    `;

    const summaryResult = await model.generateContent(prompt);
    const summary = await summaryResult.response.text();

    return NextResponse.json({
      summary,
      transcript: transcriptText,
    });

  } catch (error: any) {
    console.error('Error occurred:', {
      videoId,
      message: error.message,
      name: error.name,
      stack: error.stack,
      isGeminiError: error.name === 'GoogleGenerativeAIError',
    });

    if (error.name === 'GoogleGenerativeAIError') {
      return NextResponse.json({ error: `Gemini API error: ${error.message}` }, { status: 500 });
    }

    if (error.message.includes('Could not get transcripts')) {
      return NextResponse.json({ error: 'Transcript not available for this video' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}