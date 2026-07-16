/**
 * LLM advisory engine — wraps Vercel AI SDK streamText.
 * Model-agnostic: switching Claude model version = changing one constant.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, generateText } from "ai";
import { SYSTEM_PROMPT, AUTO_CARD_INSTRUCTION } from "./prompts";
import { assembleBudgetContext, assemblePortfolioContext } from "./context";

const MODEL = "claude-sonnet-4-6"; // change here to upgrade

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export type CardView = "budget" | "portfolio";

/**
 * Auto-generate structured insight/action cards (batch, non-streaming).
 * Returns parsed card array. Throws if Claude returns invalid JSON.
 */
export async function generateCards(userId: string, view: CardView) {
  const context =
    view === "budget"
      ? await assembleBudgetContext(userId)
      : await assemblePortfolioContext(userId);

  const { text } = await generateText({
    model: anthropic(MODEL),
    system: SYSTEM_PROMPT + context,
    prompt: AUTO_CARD_INSTRUCTION,
    maxTokens: 1500,
  });

  const parsed = JSON.parse(text) as { cards: unknown[] };
  return parsed.cards;
}

/**
 * Streaming conversation for follow-up questions and alert analysis.
 * Last 10 exchanges are kept in session context (enforced by caller).
 */
export async function streamConversation(params: {
  userId: string;
  view: CardView;
  messages: { role: "user" | "assistant"; content: string }[];
  alertContext?: string;
}) {
  const context =
    params.view === "budget"
      ? await assembleBudgetContext(params.userId)
      : await assemblePortfolioContext(params.userId);

  const systemSuffix = params.alertContext
    ? `\n\nALERT CONTEXT:\n${params.alertContext}`
    : "";

  return streamText({
    model: anthropic(MODEL),
    system: SYSTEM_PROMPT + context + systemSuffix,
    messages: params.messages,
    maxTokens: 2000,
  });
}
