import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { importChat, importSignals } from "@/lib/services/import";

/**
 * Seeds two demo accounts and loads the sample dataset for the analyst.
 *
 * The data goes in through the real import service, so a broken parser fails the
 * seed rather than silently producing a database that the app could never have
 * created itself.
 *
 * Safe to re-run: existing demo users are wiped of their data first.
 */

const SAMPLES = join(process.cwd(), "samples");

function readSample(name: string): string | null {
  const path = join(SAMPLES, name);
  if (!existsSync(path)) {
    console.warn(`  ! samples/${name} missing — run \`npm run samples\` first`);
    return null;
  }
  return readFileSync(path, "utf8");
}

async function upsertUser(
  email: string,
  name: string,
  password: string,
  role: "ADMIN" | "ANALYST" | "VIEWER",
) {
  const passwordHash = await hashPassword(password);

  return prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role },
    update: { name, passwordHash, role },
  });
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
  const analystEmail = process.env.SEED_ANALYST_EMAIL ?? "analyst@example.com";
  const analystPassword = process.env.SEED_ANALYST_PASSWORD ?? "analyst12345";

  console.log("Seeding users…");

  const admin = await upsertUser(adminEmail, "Site Admin", adminPassword, "ADMIN");
  const analyst = await upsertUser(
    analystEmail,
    "Demo Analyst",
    analystPassword,
    "ANALYST",
  );
  const viewer = await upsertUser(
    "viewer@example.com",
    "Read-only Guest",
    "viewer12345",
    "VIEWER",
  );

  console.log(`  ${admin.email} (ADMIN)`);
  console.log(`  ${analyst.email} (ANALYST)`);
  console.log(`  ${viewer.email} (VIEWER)`);

  // Re-runnable: clear the analyst's data before re-importing.
  console.log("\nClearing previous demo data…");
  await prisma.signal.deleteMany({ where: { userId: analyst.id } });
  await prisma.chatMessage.deleteMany({ where: { userId: analyst.id } });
  await prisma.importBatch.deleteMany({ where: { userId: analyst.id } });
  await prisma.provider.deleteMany({ where: { userId: analyst.id } });
  await prisma.insightReport.deleteMany({ where: { userId: analyst.id } });

  console.log("\nImporting sample dataset…");

  const signalsCsv = readSample("signals.csv");
  if (signalsCsv) {
    const summary = await importSignals(analyst.id, signalsCsv, "signals.csv");
    console.log(
      `  signals.csv       ${summary.accepted} imported, ${summary.rejected} rejected`,
    );
    for (const error of summary.errors.slice(0, 3)) {
      console.log(`      row ${error.row}: ${error.reason}`);
    }
  }

  const chatTxt = readSample("chat-export.txt");
  if (chatTxt) {
    const summary = await importChat(
      analyst.id,
      chatTxt,
      "chat-export.txt",
      "signals-general",
    );
    console.log(
      `  chat-export.txt   ${summary.accepted} imported, ${summary.rejected} rejected, ${summary.duplicates} duplicates flagged`,
    );
  }

  const [signalCount, messageCount, spamCount, providerCount] = await Promise.all([
    prisma.signal.count({ where: { userId: analyst.id } }),
    prisma.chatMessage.count({ where: { userId: analyst.id } }),
    prisma.chatMessage.count({ where: { userId: analyst.id, isSpam: true } }),
    prisma.provider.count({ where: { userId: analyst.id } }),
  ]);

  console.log(
    `\nDone. ${signalCount} signals, ${messageCount} messages ` +
      `(${spamCount} flagged promotional), ${providerCount} providers.`,
  );
  console.log(`\nSign in as ${analystEmail} / ${analystPassword}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
