import { aiEnabled, env } from "@/lib/env";
import type { InsightPayload } from "@/lib/types";

/**
 * Optional narrative layer.
 *
 * The numbers are never produced here — `generateInsights` computes them locally
 * and this only rephrases the already-computed findings into prose. If no API key
 * is configured, or the call fails for any reason, the deterministic summary is
 * returned unchanged. The app is fully functional without an OpenAI key.
 *
 * Called with the plain HTTP API rather than the SDK to keep the dependency
 * surface small.
 */

const SYSTEM_PROMPT = `You are a data analyst writing the summary section of a trading-performance report.

Rules you must follow:
- You are given statistics that have ALREADY been computed. Never invent, recompute, or contradict a number. Quote only figures present in the input.
- Never give financial advice, never predict future prices, never suggest a trade to place. Describe only what the historical data shows.
- If the sample size is small, say so plainly rather than hedging vaguely.
- Write 3 to 5 sentences of plain prose. No bullet points, no headings, no markdown.
- Neutral analytical register. No hype, no emoji, no exclamation marks.`;

type ChatCompletionResponse = {
  choices?: { message?: { content?: string } }[];
};

export async function narrateInsights(
  payload: InsightPayload,
): Promise<InsightPayload> {
  if (!aiEnabled) return payload;

  // A slow model call must not hang the insights page.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const facts = {
      confidenceScore: payload.confidenceScore,
      deterministicSummary: payload.summary,
      risk: payload.riskAssessment,
      findings: payload.insights.map((insight) => ({
        kind: insight.kind,
        severity: insight.severity,
        title: insight.title,
        detail: insight.detail,
      })),
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Summarise this trading-signal analysis:\n\n${JSON.stringify(facts, null, 2)}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(
        "[ai] OpenAI returned",
        response.status,
        "- falling back to the local summary",
      );
      return payload;
    }

    const body = (await response.json()) as ChatCompletionResponse;
    const text = body.choices?.[0]?.message?.content?.trim();

    if (!text) return payload;

    return { ...payload, engine: env.OPENAI_MODEL, summary: text };
  } catch (error) {
    console.error("[ai] summary call failed, using local summary:", error);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Condenses a chat window into a short digest.
 *
 * Same contract as above: without a key this returns a locally-assembled digest
 * rather than nothing at all.
 */
export async function summarizeDiscussion(input: {
  messageCount: number;
  topAssets: { name: string; count: number }[];
  topStrategies: { name: string; count: number }[];
  bullish: number;
  bearish: number;
  neutral: number;
  spam: number;
  samples: string[];
}): Promise<{ engine: string; text: string }> {
  const local = localDigest(input);

  if (!aiEnabled) return { engine: "heuristic", text: local };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 350,
        messages: [
          {
            role: "system",
            content: `You summarise trading chat rooms for an analytics dashboard.
Describe what the room discussed and the mood, in 3-4 plain sentences.
Do not give financial advice or predict prices. Do not repeat promotional content.
Use only the counts and excerpts provided. No markdown, no emoji.`,
          },
          {
            role: "user",
            content: JSON.stringify(input, null, 2),
          },
        ],
      }),
    });

    if (!response.ok) return { engine: "heuristic", text: local };

    const body = (await response.json()) as ChatCompletionResponse;
    const text = body.choices?.[0]?.message?.content?.trim();

    return text
      ? { engine: env.OPENAI_MODEL, text }
      : { engine: "heuristic", text: local };
  } catch {
    return { engine: "heuristic", text: local };
  } finally {
    clearTimeout(timeout);
  }
}

function localDigest(input: {
  messageCount: number;
  topAssets: { name: string; count: number }[];
  topStrategies: { name: string; count: number }[];
  bullish: number;
  bearish: number;
  neutral: number;
  spam: number;
}): string {
  if (input.messageCount === 0) {
    return "No messages matched the current filters.";
  }

  const assets =
    input.topAssets.length > 0
      ? input.topAssets
          .slice(0, 4)
          .map((a) => `${a.name} (${a.count})`)
          .join(", ")
      : "no specific assets";

  const strategies =
    input.topStrategies.length > 0
      ? input.topStrategies
          .slice(0, 3)
          .map((s) => s.name)
          .join(", ")
      : "no identifiable strategy vocabulary";

  const dominant =
    input.bullish > input.bearish
      ? "leans bullish"
      : input.bearish > input.bullish
        ? "leans bearish"
        : "is evenly split";

  const spamNote =
    input.spam > 0
      ? ` ${input.spam} message${input.spam === 1 ? " was" : "s were"} flagged as promotional and are excluded from the tone read.`
      : "";

  return (
    `${input.messageCount} messages analysed. Discussion centres on ${assets}, ` +
    `with recurring talk of ${strategies}. ` +
    `Overall tone ${dominant} — ${input.bullish} bullish, ${input.bearish} bearish, ${input.neutral} neutral.` +
    spamNote
  );
}
