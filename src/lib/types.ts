/**
 * Shared vocabulary for the whole app.
 *
 * These mirror the Prisma enums deliberately rather than re-exporting them:
 * `@prisma/client` is a server-only package, and client components need these
 * same unions for props and filter state.
 */

export type Role = "ADMIN" | "ANALYST" | "VIEWER";
export type Direction = "BUY" | "SELL";
export type SignalResult = "WIN" | "LOSS" | "DRAW" | "PENDING";
export type Sentiment = "BULLISH" | "BEARISH" | "NEUTRAL";
export type ImportKind = "SIGNALS" | "CHAT";

export const ROLES: Role[] = ["ADMIN", "ANALYST", "VIEWER"];
export const DIRECTIONS: Direction[] = ["BUY", "SELL"];
export const RESULTS: SignalResult[] = ["WIN", "LOSS", "DRAW", "PENDING"];
export const SENTIMENTS: Sentiment[] = ["BULLISH", "BEARISH", "NEUTRAL"];

/** The filter set every analytics endpoint understands. */
export type SignalFilters = {
  from?: string;
  to?: string;
  asset?: string;
  provider?: string;
  result?: SignalResult;
  direction?: Direction;
  /** Expiry length in seconds. */
  timeframe?: number;
};

export type SignalDTO = {
  id: string;
  asset: string;
  direction: Direction;
  entryAt: string;
  expiresAt: string;
  timeframeSec: number;
  result: SignalResult;
  stake: number | null;
  payout: number | null;
  pnl: number | null;
  confidence: number | null;
  provider: string | null;
};

export type ChatMessageDTO = {
  id: string;
  channel: string;
  author: string;
  content: string;
  postedAt: string;
  sentiment: Sentiment;
  sentimentScore: number;
  assets: string[];
  strategies: string[];
  isSpam: boolean;
  spamReason: string | null;
  isDuplicate: boolean;
};

/** Win rate and friends, computed over an arbitrary slice of signals. */
export type PerformanceStats = {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  pending: number;
  /** wins / (wins + losses), ignoring draws and pending. */
  winRate: number;
  /** Directional correctness including draws in the denominator. */
  accuracy: number;
  netPnl: number;
  avgPnl: number;
  profitFactor: number | null;
  /** Longest consecutive win and loss runs, in entry order. */
  bestStreak: number;
  worstStreak: number;
};

export type Bucket = PerformanceStats & {
  key: string;
  label: string;
};

export type SeriesPoint = {
  date: string;
  winRate: number;
  accuracy: number;
  pnl: number;
  cumulativePnl: number;
  count: number;
};

export type HeatCell = {
  weekday: number;
  hour: number;
  count: number;
  winRate: number;
};

export type SentimentPoint = {
  date: string;
  bullish: number;
  bearish: number;
  neutral: number;
  /** Mean polarity for the day, in [-1, 1]. */
  score: number;
};

export type Insight = {
  id: string;
  kind: "trend" | "risk" | "pattern" | "sentiment" | "recommendation";
  severity: "info" | "good" | "warning" | "critical";
  title: string;
  detail: string;
  /** How much data backs this observation, 0..1. */
  confidence: number;
};

export type InsightPayload = {
  engine: string;
  generatedAt: string;
  confidenceScore: number;
  summary: string;
  insights: Insight[];
  riskAssessment: {
    level: "low" | "moderate" | "elevated" | "high";
    score: number;
    factors: string[];
  };
};
