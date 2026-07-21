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
import { requireUser } from "@/lib/auth-guard";
import { streamConversation, type CardView } from "@/lib/llm/advisory";

const MAX_MESSAGES = 20; // 10 exchanges (user + assistant = 2 per exchange)

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const { view, messages, alertContext } = (await req.json()) as {
    view: CardView;
    messages: { role: "user" | "assistant"; content: string }[];
    alertContext?: string;
  };

  // Cap at last 10 exchanges
  const cappedMessages = messages.slice(-MAX_MESSAGES);

  const result = await streamConversation({
    userId: authed.userId,
    view,
    messages: cappedMessages,
    alertContext,
  });

  // v7 UI message stream — consumed by @ai-sdk/react's useChat on the frontend
  return result.toUIMessageStreamResponse();
}
