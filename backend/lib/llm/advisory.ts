/**
 * LLM advisory engine — Vercel AI SDK v7 (streamText/generateText with
 * server-side tool loop). Model-agnostic: switching Claude model version =
 * changing one constant.
 */
import { streamText, generateText, stepCountIs } from "ai";
import { SYSTEM_PROMPT, AUTO_CARD_INSTRUCTION } from "./prompts";
import { assembleBudgetContext, assemblePortfolioContext } from "./context";
import { anthropic, assembleTools } from "./tools";
import { parseCards } from "./parse-cards";
import { validateCards, type CardLike } from "./validate-cards";

const MODEL = "claude-sonnet-4-6"; // change here to upgrade

// Keep in step with lib/jobs/nightly.ts — see the note there on server tools
// consuming the output budget.
const MAX_OUTPUT_TOKENS = 16000;

// Tool loop ceiling per call: enough for a few indicator lookups + searches
// around the actual answer, low enough to bound cost and latency.
const MAX_STEPS = 8;

export type CardView = "budget" | "portfolio";

/**
 * Auto-generate structured insight/action cards (non-streaming synchronous
 * fallback path — the nightly Batch API job is the primary generator, §7).
 * Returns parsed card array. Throws if Claude returns invalid JSON.
 */
export async function generateCards(userId: string, view: CardView) {
  const context =
    view === "budget"
      ? await assembleBudgetContext(userId)
      : await assemblePortfolioContext(userId);
  const { tools, systemSuffix } = await assembleTools(
    view === "budget" ? "budget-cards" : "portfolio-cards"
  );

  const { text } = await generateText({
    model: anthropic(MODEL),
    system: SYSTEM_PROMPT + context + systemSuffix,
    prompt: AUTO_CARD_INSTRUCTION,
    // Matches the batch path: tool calls draw on the same output budget, and
    // 1500 was low enough for a real request to exhaust it before any text.
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  // Item 4: math checks the model. Cards whose cited dollar amounts aren't
  // derivable from the context, or whose %-relations don't hold, are dropped
  // — a card the arithmetic can't verify is worth less than no card.
  const { cards, dropped } = validateCards(parseCards(text) as CardLike[], context);
  if (dropped.length > 0) {
    console.warn(
      `[validate-cards] dropped ${dropped.length}/${dropped.length + cards.length} ${view} card(s):`,
      dropped.map((d) => `"${d.title}" — ${d.reasons.join("; ")}`).join(" | ")
    );
  }
  return cards;
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
  const { tools, systemSuffix } = await assembleTools();

  const alertSuffix = params.alertContext
    ? `\n\nALERT CONTEXT:\n${params.alertContext}`
    : "";

  return streamText({
    model: anthropic(MODEL),
    system: SYSTEM_PROMPT + context + alertSuffix + systemSuffix,
    messages: params.messages,
    maxOutputTokens: 2000,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });
}
