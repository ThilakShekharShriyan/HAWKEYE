const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
const MODEL_ID = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return Response.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 503 });
  }

  const { text } = (await request.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return Response.json({ error: "text required" }, { status: 400 });

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 600), model_id: MODEL_ID }),
    },
  );
  if (!response.ok || !response.body) {
    return Response.json(
      { error: `ElevenLabs ${response.status}: ${await response.text()}` },
      { status: 502 },
    );
  }

  return new Response(response.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
