import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Left panel states what the product is before asking for credentials. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-void p-10 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-accent/10 blur-3xl"
        />

        <div className="relative">
          <Wordmark />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-2xl font-semibold leading-snug tracking-tight text-ink">
            Your signal history, measured properly.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            Import the chat logs and signal exports you already have. Pocket
            Signal Lab computes win rate, accuracy, drawdown and sentiment from
            those rows — locally, with the sample size shown next to every
            number.
          </p>

          <ul className="mt-6 space-y-2.5 text-xs text-ink-faint">
            {[
              "Reads CSV, JSON and plain-text exports",
              "Flags promotional messages and duplicates",
              "Exports to CSV, Excel and PDF",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] leading-relaxed text-ink-faint">
          Works only on data you provide. It does not connect to a broker, log
          into an account, or collect anything on your behalf.
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-in">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 ring-1 ring-accent/30">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4a7" strokeWidth="2.2">
          <path d="M3 16.5 8.5 11l3.5 3.5L21 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="text-sm font-semibold tracking-tight text-ink">
        Pocket Signal Lab
      </span>
    </div>
  );
}
