import { z } from "zod";

/**
 * Server-side environment, validated once at module load so a misconfigured deploy
 * fails immediately and loudly instead of throwing somewhere deep in a request.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters — generate one with `openssl rand -base64 48`"),
  AUTH_SESSION_TTL: z.string().default("7d"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();

/** True when an OpenAI key is configured; drives the AI-vs-heuristic branch. */
export const aiEnabled = env.OPENAI_API_KEY.trim().length > 0;
