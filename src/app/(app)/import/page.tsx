import type { Metadata } from "next";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { ImportForm } from "./ImportForm";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await requireUser();

  const batches = await prisma.importBatch.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  return (
    <>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Import data</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Bring in a signal export or a chat transcript you already have.
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader
            title="New import"
            subtitle="Files are parsed in place — nothing is uploaded anywhere else"
          />
          <div className="px-5 py-5">
            <ImportForm canImport={session.role !== "VIEWER"} />
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader
              title="Where the data comes from"
              subtitle="What this app will and will not do"
            />

            <div className="space-y-3 px-5 py-4 text-xs leading-relaxed text-ink-dim">
              <p>
                Pocket Signal Lab only reads what you give it. It does not sign
                into Pocket Option, does not scrape the platform, and holds no
                broker credentials. If you can export it or copy it, you can
                analyse it here.
              </p>
              <p>
                In practice that means your own trade history export, your own
                message logs from a room you are a member of, or a signal feed
                you subscribe to and are permitted to keep records of.
              </p>
              <p className="text-ink-faint">
                Check the terms of any room or service before redistributing
                what you export from it.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Formats it understands"
              subtitle="Column names are matched loosely"
            />

            <div className="space-y-4 px-5 py-4 text-xs text-ink-dim">
              <div>
                <h3 className="mb-1 font-medium text-ink">Signals</h3>
                <ul className="space-y-1 text-[11px] text-ink-faint">
                  <li>
                    <strong className="text-ink-dim">CSV</strong> — needs an
                    asset, a direction, an entry time, and either an expiry time
                    or a duration. Headers like <code>Entry Time</code>,{" "}
                    <code>entry_time</code> and <code>openTime</code> all resolve
                    to the same field.
                  </li>
                  <li>
                    <strong className="text-ink-dim">JSON</strong> — an array, or
                    an object with a <code>signals</code> or <code>data</code>{" "}
                    array.
                  </li>
                  <li>
                    <strong className="text-ink-dim">Plain text</strong> — one
                    signal per line, e.g.{" "}
                    <code>EUR/USD OTC BUY M5 09:15 WIN</code>.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="mb-1 font-medium text-ink">Chat</h3>
                <ul className="space-y-1 text-[11px] text-ink-faint">
                  <li>
                    <strong className="text-ink-dim">Plain text</strong> —{" "}
                    <code>[2026-07-14 09:15] alice: message</code>, WhatsApp-style
                    exports, or <code>09:15 alice: message</code>. Multi-line
                    messages are kept together.
                  </li>
                  <li>
                    <strong className="text-ink-dim">JSON</strong> — including
                    Telegram Desktop exports.
                  </li>
                  <li>
                    <strong className="text-ink-dim">CSV</strong> — with a
                    message/content column and a timestamp.
                  </li>
                </ul>
              </div>

              <p className="text-[11px] text-ink-faint">
                Rows that cannot be read are reported individually rather than
                failing the whole file.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {batches.length > 0 ? (
        <Panel className="mt-5">
          <PanelHeader
            title="Import history"
            subtitle="Your most recent uploads"
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead>
                <tr className="border-b border-line-soft text-[10px] uppercase tracking-wider text-ink-faint">
                  <th scope="col" className="px-5 py-2.5">When</th>
                  <th scope="col" className="px-5 py-2.5">File</th>
                  <th scope="col" className="px-5 py-2.5">Type</th>
                  <th scope="col" className="px-5 py-2.5 text-right">Found</th>
                  <th scope="col" className="px-5 py-2.5 text-right">Imported</th>
                  <th scope="col" className="px-5 py-2.5 text-right">Rejected</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line-soft">
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-[11px] text-ink-faint">
                      {batch.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="max-w-[200px] truncate px-5 py-2.5 text-ink">
                      {batch.filename}
                    </td>
                    <td className="px-5 py-2.5 text-ink-dim">{batch.kind}</td>
                    <td className="px-5 py-2.5 text-right tnum text-ink-dim">
                      {batch.rowCount.toLocaleString()}
                    </td>
                    <td className="px-5 py-2.5 text-right tnum text-win">
                      {batch.acceptedCount.toLocaleString()}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right tnum ${
                        batch.rejectedCount > 0 ? "text-loss" : "text-ink-faint"
                      }`}
                    >
                      {batch.rejectedCount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
