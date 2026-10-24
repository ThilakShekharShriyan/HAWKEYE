import { connection } from "next/server";
import { onEvent } from "@/lib/events-repo";
import { currentVoices, onVoice } from "@/lib/voice-bus";

export async function GET(request: Request) {
  await connection();
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let unsubscribeVoice = () => {};
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const heartbeat = setInterval(() => send(": keepalive\n\n"), 15000);
      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        unsubscribeVoice();
        try {
          controller.close();
        } catch {}
      };

      cleanup = close;

      unsubscribe = onEvent((event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      request.signal.addEventListener("abort", close);

      send(": connected\n\n");
      for (const snapshot of currentVoices()) {
        send(`event: voice\ndata: ${JSON.stringify(snapshot)}\n\n`);
      }
      unsubscribeVoice = onVoice((snapshot) => {
        send(`event: voice\ndata: ${JSON.stringify(snapshot)}\n\n`);
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
