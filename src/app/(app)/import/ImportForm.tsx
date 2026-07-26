"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Badge } from "@/components/ui/primitives";

type Summary = {
  kind: string;
  filename: string;
  seen: number;
  accepted: number;
  rejected: number;
  duplicates?: number;
  errors: { row: number; reason: string; raw?: string }[];
};

export function ImportForm({ canImport }: { canImport: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<"SIGNALS" | "CHAT">("SIGNALS");
  const [channel, setChannel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);

    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setPasted("");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    if (!file && !pasted.trim()) {
      setError("Choose a file or paste some text first.");
      return;
    }

    setPending(true);
    setError(null);
    setSummary(null);

    try {
      let response: Response;

      if (file) {
        const form = new FormData();
        form.set("file", file);
        form.set("kind", kind);
        if (channel.trim()) form.set("channel", channel.trim());

        response = await fetch("/api/import", { method: "POST", body: form });
      } else {
        response = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            // Pasted text has no filename, so the parser sniffs the content.
            filename: kind === "SIGNALS" ? "pasted-signals" : "pasted-chat",
            content: pasted,
            channel: channel.trim() || undefined,
          }),
        });
      }

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "The import failed.");
        setPending(false);
        return;
      }

      setSummary(body as Summary);
      setFile(null);
      setPasted("");
      if (inputRef.current) inputRef.current.value = "";

      // Pull the new rows into every server-rendered view.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (!canImport) {
    return (
      <div className="rounded-lg border border-pending/30 bg-pending/8 px-4 py-3 text-xs text-pending">
        Your account is read-only. Ask an administrator for the Analyst role to
        import data.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="label-eyebrow mb-1.5">What are you importing?</legend>

          <div className="grid gap-2 sm:grid-cols-2">
            <KindOption
              value="SIGNALS"
              current={kind}
              onSelect={setKind}
              title="Signal history"
              detail="Trade or signal rows with an asset, direction, time and outcome."
            />
            <KindOption
              value="CHAT"
              current={kind}
              onSelect={setKind}
              title="Chat messages"
              detail="A room transcript. Each message gets scored and tagged."
            />
          </div>
        </fieldset>

        {kind === "CHAT" ? (
          <label className="flex flex-col gap-1.5">
            <span className="label-eyebrow">Channel name (optional)</span>
            <input
              type="text"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              placeholder="signals-general"
              className="rounded-lg border border-line bg-void px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            />
            <span className="text-[11px] text-ink-faint">
              Used when the file does not name the channel itself.
            </span>
          </label>
        ) : null}

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-9 text-center transition ${
            dragging
              ? "border-accent bg-accent/8"
              : "border-line bg-panel-2/50 hover:border-accent/50"
          }`}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="text-ink-faint"
          >
            <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" strokeLinecap="round" />
          </svg>

          <span className="text-sm text-ink">
            {file ? file.name : "Drop a file here, or click to choose"}
          </span>
          <span className="text-[11px] text-ink-faint">
            {file
              ? `${(file.size / 1024).toFixed(0)} KB`
              : ".csv, .json, .txt or .log — up to 8 MB"}
          </span>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.json,.txt,.log,text/csv,application/json,text/plain"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              setFile(chosen);
              if (chosen) setPasted("");
            }}
          />
        </label>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[11px] text-ink-faint">or paste it</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Paste export contents</span>
          <textarea
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value);
              if (event.target.value) setFile(null);
            }}
            rows={6}
            placeholder={
              kind === "SIGNALS"
                ? "EUR/USD OTC  BUY  M5  2026-07-14 09:15  WIN\nGBP/JPY  SELL  M1  2026-07-14 09:22  LOSS"
                : "[2026-07-14 09:15] alice: EUR/USD looking strong above support"
            }
            className="rounded-lg border border-line bg-void px-3 py-2.5 font-mono text-xs leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
          />
        </label>

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-loss/30 bg-loss/10 px-3.5 py-2.5 text-xs text-loss"
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-abyss transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-55"
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </form>

      {summary ? <ImportSummary summary={summary} /> : null}
    </div>
  );
}

function KindOption({
  value,
  current,
  onSelect,
  title,
  detail,
}: {
  value: "SIGNALS" | "CHAT";
  current: string;
  onSelect: (value: "SIGNALS" | "CHAT") => void;
  title: string;
  detail: string;
}) {
  const active = current === value;

  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`rounded-lg border px-3.5 py-3 text-left transition ${
        active
          ? "border-accent/60 bg-accent/8"
          : "border-line bg-panel-2/40 hover:border-line"
      }`}
    >
      <span
        className={`block text-sm font-medium ${active ? "text-accent-bright" : "text-ink"}`}
      >
        {title}
      </span>
      <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
        {detail}
      </span>
    </button>
  );
}

function ImportSummary({ summary }: { summary: Summary }) {
  const clean = summary.rejected === 0;

  return (
    <div className="panel animate-in">
      <header className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-ink">Import complete</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">{summary.filename}</p>
        </div>
        <Badge tone={clean ? "win" : "pending"}>
          {clean ? "no errors" : `${summary.rejected} rejected`}
        </Badge>
      </header>

      <dl className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-4">
        <Figure label="Rows found" value={summary.seen} />
        <Figure label="Imported" value={summary.accepted} tone="good" />
        <Figure
          label="Rejected"
          value={summary.rejected}
          tone={summary.rejected > 0 ? "bad" : "neutral"}
        />
        <Figure
          label="Duplicates"
          value={summary.duplicates ?? 0}
          tone={summary.duplicates ? "warn" : "neutral"}
        />
      </dl>

      {summary.errors.length > 0 ? (
        <div className="border-t border-line-soft px-5 py-4">
          <h3 className="mb-2 text-xs font-medium text-ink">
            Rows that could not be read
          </h3>
          <p className="mb-3 text-[11px] text-ink-faint">
            These were skipped. Everything else imported normally.
          </p>

          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {summary.errors.map((error, index) => (
              <li
                key={`${error.row}-${index}`}
                className="flex gap-2 rounded-md bg-void px-2.5 py-1.5 text-[11px]"
              >
                <span className="shrink-0 font-mono text-ink-faint">
                  row {error.row}
                </span>
                <span className="text-ink-dim">{error.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const toneClass = {
    neutral: "text-ink",
    good: "text-win",
    bad: "text-loss",
    warn: "text-pending",
  }[tone];

  return (
    <div className="bg-panel px-4 py-3">
      <dt className="label-eyebrow">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tnum ${toneClass}`}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
