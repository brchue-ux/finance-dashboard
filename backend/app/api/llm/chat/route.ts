/**
 * POST /api/llm/chat
 * Streaming conversation endpoint. Returns a Server-Sent Events stream.
 * Last 10 exchanges enforced: caller sends messages array (capped at 20 items / 10 exchanges).
 *
 * Body: {
 *   view: "budget" | "portfolio",
 *   messages: { role: "user" | "assistant", content: string }[],
 *   alertContext?: string
 * }
 */
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { streamConversation, type CardView } from "@/lib/llm/advisory";

const MAX_MESSAGES = 20; // 10 exchanges (user + assistant = 2 per exchange)

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { view, messages, alertContext } = (await req.json()) as {
    view: CardView;
    messages: { role: "user" | "assistant"; content: string }[];
    alertContext?: string;
  };

  // Cap at last 10 exchanges
  const cappedMessages = messages.slice(-MAX_MESSAGES);

  const result = await streamConversation({
    userId: session.user.id,
    view,
    messages: cappedMessages,
    alertContext,
  });

  // v7 UI message stream — consumed by @ai-sdk/react's useChat on the frontend
  return result.toUIMessageStreamResponse();
}
