import {
  BEARISH_TERMS,
  BULLISH_TERMS,
  INTENSIFIERS,
  NEGATORS,
} from "@/lib/analysis/lexicon";
import type { Sentiment } from "@/lib/types";

export type SentimentResult = {
  sentiment: Sentiment;
  /** Normalised polarity in [-1, 1]. */
  score: number;
  /** Terms that actually contributed, for the "why did it say that" view. */
  matches: { term: string; weight: number; negated: boolean }[];
};

/** Bucketing threshold — below this magnitude a message reads as neutral. */
const NEUTRAL_BAND = 0.12;

/** How many tokens back a negator or intensifier still applies. */
const MODIFIER_WINDOW = 3;

/**
 * Splits text into comparable tokens while keeping emoji, which carry real
 * signal in trading chat, as tokens of their own.
 */
function tokenize(text: string): string[] {
  const withSpacedEmoji = text.replace(
    /(\p{Extended_Pictographic})/gu,
    " $1 ",
  );

  return withSpacedEmoji
    .toLowerCase()
    .split(/[^\p{L}\p{N}'\p{Extended_Pictographic}]+/u)
    .filter(Boolean);
}

/**
 * Lexicon sentiment scoring with negation and intensifier handling.
 *
 * The raw sum is squashed with x/(x+k) rather than divided by token count: a long
 * message with one strong term shouldn't be diluted into neutrality, but ten
 * strong terms shouldn't score ten times as extreme either.
 */
export function analyzeSentiment(text: string): SentimentResult {
  const tokens = tokenize(text);
  const matches: SentimentResult["matches"] = [];

  let raw = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    const bullish = BULLISH_TERMS[token];
    const bearish = BEARISH_TERMS[token];
    if (bullish === undefined && bearish === undefined) continue;

    let weight = bullish !== undefined ? bullish : -(bearish as number);

    // Look back a few tokens for a negator or intensifier.
    let negated = false;
    let multiplier = 1;

    for (let back = 1; back <= MODIFIER_WINDOW && i - back >= 0; back += 1) {
      const previous = tokens[i - back];

      if (NEGATORS.has(previous)) {
        negated = true;
        break;
      }

      const intensity = INTENSIFIERS[previous];
      if (intensity !== undefined) {
        multiplier *= intensity;
      }
    }

    // A negated term isn't the opposite at full strength — "not great" is mildly
    // negative, not strongly negative — so it's damped as well as flipped.
    if (negated) weight *= -0.7;
    weight *= multiplier;

    raw += weight;
    matches.push({ term: token, weight: Number(weight.toFixed(2)), negated });
  }

  const magnitude = Math.abs(raw);
  const squashed = magnitude / (magnitude + 4);
  const score = raw === 0 ? 0 : Math.sign(raw) * squashed;

  let sentiment: Sentiment = "NEUTRAL";
  if (score > NEUTRAL_BAND) sentiment = "BULLISH";
  else if (score < -NEUTRAL_BAND) sentiment = "BEARISH";

  return { sentiment, score: Number(score.toFixed(4)), matches };
}

/** Aggregate polarity across many messages, weighted equally per message. */
export function aggregateSentiment(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, value) => acc + value, 0);
  return Number((sum / scores.length).toFixed(4));
}
