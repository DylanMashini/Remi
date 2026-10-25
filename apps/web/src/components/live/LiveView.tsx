"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EventIcon, eventTitle, isRepeat, type EventJson } from "../events";
import { capitalize, formatTime, initials } from "../format";
import { ArrowLeftIcon, ShieldIcon } from "../icons";
import { HorizonMark, Wordmark } from "../Logo";

type PersonInfo = { id: string; name: string; relationship: string | null; notes: string | null; avatarUrl: string | null };
type Conn = "connecting" | "live" | "reconnecting" | "signed-out";

const FEED_SIZE = 20;

async function fetchPeople(): Promise<Map<string, PersonInfo> | null> {
  try {
    const res = await fetch("/api/people", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { people?: PersonInfo[] };
    return new Map((data.people ?? []).map((p) => [p.id, p]));
  } catch {
    return null; // Avatars fall back to initials.
  }
}

function mergeEvents(prev: EventJson[], incoming: EventJson[]): EventJson[] {
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, FEED_SIZE);
}

function PersonPhoto({ person, name, size }: { person?: PersonInfo; name: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (person?.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authed route
      <img
        src={person.avatarUrl}
        alt=""
        style={style}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-pill border-[6px] border-surface bg-apricot object-cover shadow-[0_0_0_4px_#F2B48C]"
      />
    );
  }
  return (
    <div
      style={style}
      className="flex shrink-0 items-center justify-center rounded-pill border-[6px] border-surface bg-apricot font-display font-extrabold text-ink shadow-[0_0_0_4px_#F2B48C]"
    >
      {initials(name)}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(formatTime(new Date()));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-display text-2xl font-bold tabular-nums text-ink-soft">{now ?? ""}</span>;
}

export function LiveView({ patientName }: { patientName: string }) {
  const [events, setEvents] = useState<EventJson[]>([]);
  const [people, setPeople] = useState<Map<string, PersonInfo>>(new Map());
  const [conn, setConn] = useState<Conn>("connecting");
  const [loadError, setLoadError] = useState<string | null>(null);
  const knownIds = useRef<Set<string>>(new Set());
  const peopleLoading = useRef(false);

  const refreshPeople = useCallback(() => {
    if (peopleLoading.current) return;
    peopleLoading.current = true;
    fetchPeople()
      .then((map) => {
        if (!map) return;
        knownIds.current = new Set(map.keys());
        setPeople(map);
      })
      .finally(() => {
        peopleLoading.current = false;
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events?limit=${FEED_SIZE}`, { cache: "no-store" });
        if (res.status === 401) {
          if (!cancelled) setConn("signed-out");
          return;
        }
        if (!res.ok) throw new Error(`events ${res.status}`);
        const data = (await res.json()) as { events?: EventJson[] };
        if (!cancelled) setEvents((prev) => mergeEvents(prev, data.events ?? []));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load events");
      }
    })();
    refreshPeople();

    const es = new EventSource("/api/stream");
    es.onopen = () => setConn("live");
    es.onerror = () => setConn((c) => (c === "signed-out" ? c : "reconnecting"));
    es.addEventListener("event", (msg) => {
      try {
        const ev = JSON.parse((msg as MessageEvent<string>).data) as EventJson;
        setEvents((prev) => mergeEvents(prev, [ev]));
        setConn("live");
        // Someone enrolled after the page loaded: refresh the roster for their photo.
        if (ev.type === "RECOGNITION" && ev.personId && !knownIds.current.has(ev.personId)) refreshPeople();
      } catch {
        // Ignore malformed frames.
      }
    });
    return () => {
      cancelled = true;
      es.close();
    };
  }, [refreshPeople]);

  const lastSpoken = events.find((e) => e.type === "SPOKEN");
  const lastSeen = events.find((e) => e.type === "RECOGNITION" || e.type === "UNKNOWN");
  const lastPerson = lastSeen?.personId ? people.get(lastSeen.personId) : undefined;

  const connLabel = {
    connecting: "Connecting",
    live: "Live",
    reconnecting: "Reconnecting",
    "signed-out": "Signed out",
  }[conn];

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-linen text-ink">
      <header className="flex shrink-0 items-center gap-4 border-b border-sand bg-surface px-5 py-3 lg:px-10 lg:py-4">
        <Link
          href="/"
          className="inline-flex h-10 w-10 items-center justify-center rounded-pill bg-sand text-ink hover:bg-line hover:text-ink"
          aria-label="Back to dashboard"
        >
          <ArrowLeftIcon size={18} />
        </Link>
        <Wordmark size={32} />
        <span
          className={`inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-base font-bold ${
            conn === "live" ? "bg-dusk-mist text-dusk-deep" : "bg-attention-bg text-attention"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-pill ${conn === "live" ? "animate-pulse-dot bg-dusk" : "bg-attention"}`}
            aria-hidden="true"
          />
          {connLabel}
        </span>
        <span className="ml-auto">
          <Clock />
        </span>
      </header>

      {conn === "signed-out" ? (
        <div className="flex flex-1 items-center justify-center p-10 text-center">
          <p className="font-display text-3xl font-bold">
            Signed out. <Link href="/login">Sign in</Link> to show the live view.
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(360px,1fr)] lg:gap-8 lg:overflow-hidden lg:p-10">
          <div className="flex min-h-0 flex-col gap-5 lg:gap-8">
            <section
              aria-live="polite"
              className="flex min-h-[220px] min-w-0 flex-1 flex-col justify-center gap-5 overflow-hidden rounded-lg bg-sky p-7 text-ink shadow-[inset_0_-3px_0_var(--color-dusk)] lg:p-12"
            >
              <span className="flex items-center gap-3 font-display text-xl font-bold text-dusk-deep lg:text-2xl">
                <HorizonMark size={32} />
                Remi says to {patientName}
                {lastSpoken ? <span className="font-body text-lg font-normal text-ink-soft">{formatTime(lastSpoken.createdAt)}</span> : null}
              </span>
              {lastSpoken ? (
                <p
                  key={lastSpoken.id}
                  className="m-0 animate-arrive text-balance font-display text-[clamp(28px,3.6vw,60px)] font-extrabold leading-[1.12] tracking-tight"
                >
                  &ldquo;{lastSpoken.text}&rdquo;
                </p>
              ) : (
                <p className="m-0 font-display text-[clamp(28px,3.4vw,52px)] font-bold leading-tight text-ink-soft">
                  Waiting for Remi to speak.
                </p>
              )}
            </section>

            <section className="flex shrink-0 items-center gap-6 rounded-lg bg-surface p-6 lg:gap-8 lg:p-8">
              {lastSeen?.type === "RECOGNITION" ? (
                <>
                  <PersonPhoto
                    key={lastSeen.id}
                    person={lastPerson}
                    name={lastPerson?.name ?? lastSeen.personName ?? "?"}
                    size={132}
                  />
                  <div key={`t-${lastSeen.id}`} className="flex min-w-0 animate-arrive flex-col gap-1.5">
                    <span className="text-lg font-bold text-ink-soft">Last recognized · {formatTime(lastSeen.createdAt)}</span>
                    <span className="truncate font-display text-[clamp(36px,3.6vw,60px)] font-extrabold leading-none">
                      {lastPerson?.name ?? lastSeen.personName ?? "Someone enrolled"}
                    </span>
                    {lastPerson?.relationship ? (
                      <span className="font-display text-2xl font-bold text-dusk-deep lg:text-3xl">
                        {capitalize(lastPerson.relationship)}
                      </span>
                    ) : null}
                    {typeof (lastSeen.data as { score?: unknown } | null)?.score === "number" ? (
                      <span className="text-base text-ink-soft">
                        Match {Math.round(((lastSeen.data as { score: number }).score) * 100)}%
                      </span>
                    ) : null}
                  </div>
                </>
              ) : lastSeen?.type === "UNKNOWN" ? (
                <>
                  <div className="flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded-pill bg-attention-bg font-display text-6xl font-extrabold text-attention">
                    ?
                  </div>
                  <div key={lastSeen.id} className="flex animate-arrive flex-col gap-1.5">
                    <span className="text-lg font-bold text-ink-soft">{formatTime(lastSeen.createdAt)}</span>
                    <span className="font-display text-[clamp(32px,3.2vw,52px)] font-extrabold leading-none">Someone new</span>
                    <span className="text-xl text-ink-soft">Not on the roster. No name is guessed.</span>
                  </div>
                </>
              ) : (
                <span className="font-display text-2xl font-bold text-ink-soft">No one recognized yet.</span>
              )}
            </section>
          </div>

          <section className="flex min-h-[320px] flex-col overflow-hidden rounded-lg bg-surface">
            <h2 className="m-0 border-b border-sand px-6 py-4 font-display text-2xl font-extrabold">Memory log</h2>
            {loadError && events.length === 0 ? (
              <p className="m-0 px-6 py-5 text-lg text-attention">Could not load the log yet ({loadError}).</p>
            ) : null}
            {events.length === 0 && !loadError ? (
              <p className="m-0 px-6 py-5 text-lg text-ink-soft">Nothing yet. Everything Remi sees, hears, and says lands here.</p>
            ) : null}
            <ol className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-0">
              {events.map((e) => (
                <li key={e.id} className="flex animate-arrive items-start gap-3.5 border-b border-sand px-6 py-3.5 last:border-b-0">
                  <EventIcon type={e.type} size={40} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-base font-bold text-ink-soft">
                      {eventTitle(e.type, patientName, e.personName)}
                      {e.type === "QUESTION" && isRepeat(e.data) ? (
                        <span className="rounded-pill bg-attention-bg px-2 py-0.5 text-xs text-attention">Asked again</span>
                      ) : null}
                    </span>
                    <span
                      className={`break-words text-lg leading-snug ${e.type === "SPOKEN" ? "font-display font-bold text-dusk-deep" : ""}`}
                    >
                      {e.type === "SPOKEN" ? <>&ldquo;{e.text}&rdquo;</> : e.text}
                    </span>
                  </div>
                  <span className="shrink-0 pt-0.5 text-base tabular-nums text-ink-soft">{formatTime(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

      <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-sand bg-surface px-5 py-2.5 text-base text-ink-soft">
        <ShieldIcon size={16} className="text-dusk" />
        Faces are matched only against people you enroll. Camera frames are never stored.
      </footer>
    </div>
  );
}
