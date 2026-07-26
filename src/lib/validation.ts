import { z } from "zod";

/** Request-body schemas. Every mutating endpoint validates through one of these. */

export const registerSchema = z.object({
  email: z.email("Enter a valid email address").max(254).toLowerCase().trim(),
  name: z.string().min(1, "Name is required").max(80).trim(),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(200, "That password is too long")
    // Length does most of the work; this only rules out single-class passwords
    // like "aaaaaaaaaa" that clear the length bar without adding entropy.
    .refine(
      (value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value),
      "Include at least one letter and one number",
    ),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").toLowerCase().trim(),
  password: z.string().min(1, "Enter your password"),
});

export const importSchema = z.object({
  kind: z.enum(["SIGNALS", "CHAT"]),
  filename: z.string().min(1).max(255),
  /** Raw file contents. Capped to keep a single request from exhausting memory. */
  content: z
    .string()
    .min(1, "The file is empty")
    .max(8_000_000, "File is larger than the 8 MB limit"),
  channel: z.string().max(80).optional(),
});

export const roleUpdateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "ANALYST", "VIEWER"]),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ImportInput = z.infer<typeof importSchema>;
