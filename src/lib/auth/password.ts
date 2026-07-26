import bcrypt from "bcryptjs";

/**
 * Cost factor. 12 keeps a hash around ~250ms on typical server hardware, which is
 * the usual balance between brute-force resistance and login latency.
 */
const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Burns roughly the same time as a real `verifyPassword` call.
 *
 * Login runs this when the email doesn't exist, so an attacker can't tell
 * "no such user" from "wrong password" by timing the response.
 */
export async function fakeVerify(): Promise<void> {
  await bcrypt.compare(
    "timing-equaliser",
    "$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Zx5oGZQZKfQ0hFhZ3Xk1TQFbUqvJ8W",
  );
}
