import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const geminiKey = process.env.GEMINI_KEY as string;
const rapidApiKey = process.env.RAPIDAPI_KEY as string; // Add this to your .env
const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

interface TranscriptEntry {
  offset: number;
  duration: number;
  text: string;
}

async function fetchTranscript(videoId: string): Promise<TranscriptEntry[]> {
  const url = `https://youtube-transcripts.p.rapidapi.com/youtube/transcript?videoId=${videoId}&chunkSize=500`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": rapidApiKey,
        "x-rapidapi-host": "youtube-transcripts.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch transcript: ${response.statusText}`);
    }

    const data = await response.json();
    // Debugging

    
    if (!data.content || !Array.isArray(data.content)) {
      throw new Error("Invalid transcript data received");
    }

    return data.content.map((entry: any) => ({
      offset: entry.offset,
      duration: entry.duration,
      text: entry.text,
    }));
  } catch (error) {
    console.error("Error fetching transcript:", error);
    throw error;
  }
}


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get("videoId");

  if (!videoId) {
    return NextResponse.json({ error: "Video ID is required" }, { status: 400 });
  }

  try {
    console.log(`Fetching transcript for video: ${videoId}`);

    const transcript = await fetchTranscript(videoId);

    if (!transcript || transcript.length === 0) {
      return NextResponse.json({ error: "No transcript available" }, { status: 404 });
    }

    const transcriptText = transcript.map(entry => entry.text).join(" ");

    const prompt = `
      You are an AI that summarizes YouTube transcripts. 
      Provide a concise summary with key points, highlights, and insights.

      Transcript: ${transcriptText}
    `;

    const summaryResult = await model.generateContent(prompt);
    const summary = await summaryResult.response.text();

    return NextResponse.json({
      summary,
      transcript: transcriptText,
    });
  } catch (error: any) {
    console.error("Error:", error);

    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}
