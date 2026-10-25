"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventJson } from "../events";
import { capitalize, formatTime, initials } from "../format";
import { ArrowLeftIcon, BellIcon, ChatIcon, MaximizeIcon, MemoryIcon, MinimizeIcon, PersonIcon, PillIcon, QuestionIcon, ShieldIcon } from "../icons";
import { HorizonMark, Wordmark } from "../Logo";
import { toMoments, type Moment } from "./moments";

/*
 * The projector view. The screen is one landscape: the sky of the hour above, the horizon line
 * across the middle, linen ground below. Remi's last words sit in the sky with the person they
 * were said about; the ground holds the recent moments as they arrive. Nothing here is a card
 * inside a card.
 */

type PersonInfo = { id: string; name: string; relationship: string | null; notes: string | null; avatarUrl: string | null };
type ReminderInfo = { id: string; text: string; dueAt: string; firedAt: string | null; medicationId: string | null };
type Conn = "connecting" | "live" | "reconnecting" | "signed-out";

const KEEP = 200;
const SHOW = 40;
const ACTIVE_MS = 2 * 60_000;
const IN_VIEW_MS = 5 * 60_000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function mergeEvents(prev: EventJson[], incoming: EventJson[]): EventJson[] {
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, KEEP);
}

function Portrait({ person, name, size, className = "" }: { person?: PersonInfo; name: string; size: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (person?.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authed route
      <img src={person.avatarUrl} alt="" style={style} onError={() => setBroken(true)} className={`shrink-0 rounded-pill bg-apricot object-cover ${className}`} />
    );
  }
  return (
    <div style={style} className={`flex shrink-0 items-center justify-center rounded-pill bg-apricot font-display font-extrabold text-ink ${className}`}>
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
  return (
    <span className="font-display text-[22px] font-bold tabular-nums text-ink lg:text-2xl" suppressHydrationWarning>
      {now ?? ""}
    </span>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function LiveView({ patientName }: { patientName: string }) {
  const [events, setEvents] = useState<EventJson[]>([]);
  const [people, setPeople] = useState<Map<string, PersonInfo>>(new Map());
  const [nextUp, setNextUp] = useState<ReminderInfo | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [full, setFull] = useState(false);
  const [firstIds, setFirstIds] = useState<Set<string> | null>(null);
  const knownIds = useRef<Set<string>>(new Set());
  const now = useNow(15_000);

  const refreshPeople = useCallback(async () => {
    const data = await getJson<{ people?: PersonInfo[] }>("/api/people");
    if (!data) return;
    const map = new Map((data.people ?? []).map((p) => [p.id, p]));
    knownIds.current = new Set(map.keys());
    setPeople(map);
  }, []);

  const refreshNextUp = useCallback(async () => {
    const data = await getJson<{ reminders?: ReminderInfo[] }>("/api/reminders");
    if (!data) return;
    const next = (data.reminders ?? []).filter((r) => !r.firedAt).sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null;
    setNextUp(next);
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/events?limit=${KEEP}`, { cache: "no-store" });
      if (res.status === 401) {
        setConn("signed-out");
        return;
      }
      if (!res.ok) throw new Error(`events ${res.status}`);
      const data = (await res.json()) as { events?: EventJson[] };
      const list = data.events ?? [];
      setFirstIds((cur) => cur ?? new Set(list.map((e) => e.id)));
      setEvents((prev) => mergeEvents(prev, list));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Loads start on the next tick: each one awaits the network before touching state.
    void Promise.resolve().then(() => Promise.all([loadEvents(), refreshPeople(), refreshNextUp()]));

    const es = new EventSource("/api/stream");
    es.onopen = () => setConn("live");
    es.onerror = () => setConn((c) => (c === "signed-out" ? c : "reconnecting"));
    es.addEventListener("event", (msg) => {
      try {
        const ev = JSON.parse((msg as MessageEvent<string>).data) as EventJson;
        setEvents((prev) => mergeEvents(prev, [ev]));
        setConn("live");
        if (ev.type === "RECOGNITION" && ev.personId && !knownIds.current.has(ev.personId)) void refreshPeople();
        if (ev.type === "REMINDER") void refreshNextUp();
      } catch {
        // Ignore malformed frames.
      }
    });
    // Coming back to the tab: catch up on anything missed while the socket was asleep.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadEvents();
        void refreshNextUp();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const onFull = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFull);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement)) toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      es.close();
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("fullscreenchange", onFull);
      window.removeEventListener("keydown", onKey);
    };
  }, [loadEvents, refreshNextUp, refreshPeople]);

  const moments = useMemo(() => toMoments(events).slice(0, SHOW), [events]);
  const lastSpoken = events.find((e) => e.type === "SPOKEN");
  const lastSeen = events.find((e) => e.type === "RECOGNITION" || e.type === "UNKNOWN");
  const lastPerson = lastSeen?.personId ? people.get(lastSeen.personId) : undefined;
  const latestAt = events[0] ? new Date(events[0].createdAt).getTime() : 0;
  const active = latestAt > 0 && now - latestAt < ACTIVE_MS;
  const inView = lastSeen ? now - new Date(lastSeen.createdAt).getTime() < IN_VIEW_MS : false;

  // People seen today, in order of most recent, for the rail.
  const seenToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const seen = new Map<string, EventJson>();
    for (const e of events) {
      if (e.type !== "RECOGNITION" || !e.personId) continue;
      if (new Date(e.createdAt) < start) continue;
      if (!seen.has(e.personId)) seen.set(e.personId, e);
    }
    return [...seen.values()];
  }, [events]);

  const connLabel = { connecting: "Connecting", live: "Connected", reconnecting: "Reconnecting", "signed-out": "Signed out" }[conn];

  if (conn === "signed-out") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-linen p-10 text-center text-ink">
        <p className="m-0 font-display text-3xl font-bold">
          Signed out. <Link href="/login?next=/live">Sign in</Link> to show the live view.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-linen text-ink">
      {/* Top bar: who this is, whether the feed is connected, whether the glasses are awake. */}
      <header className="flex shrink-0 items-center gap-3 bg-surface px-4 py-2.5 lg:gap-5 lg:px-8 lg:py-3">
        <Link href="/" className="inline-flex h-10 w-10 items-center justify-center rounded-pill bg-sand text-ink hover:bg-line hover:text-ink" aria-label="Back to dashboard">
          <ArrowLeftIcon size={18} />
        </Link>
        <Wordmark size={30} />
        <span className="hidden text-[17px] text-ink-soft sm:inline">with {patientName}</span>
        <span className="ml-auto flex items-center gap-2 lg:gap-3">
          <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-pill px-3 py-1.5 text-[13px] font-bold sm:text-[15px] ${active ? "bg-dusk-mist text-dusk-deep" : "bg-sand text-ink-soft"}`}>
            <span className={`h-2 w-2 rounded-pill ${active ? "animate-pulse-dot bg-dusk" : "bg-ink-mute"}`} aria-hidden="true" />
            {active ? "Glasses active" : latestAt ? `Quiet since ${formatTime(new Date(latestAt))}` : "Waiting for the glasses"}
          </span>
          <span className={`hidden items-center gap-2 rounded-pill px-3 py-1.5 text-[15px] font-bold sm:inline-flex ${conn === "live" ? "bg-sand text-ink-soft" : "bg-attention-bg text-attention"}`}>
            <span className={`h-2 w-2 rounded-pill ${conn === "live" ? "bg-dusk" : "bg-attention"}`} aria-hidden="true" />
            {connLabel}
          </span>
          <span className="hidden sm:inline">
            <Clock />
          </span>
          <button type="button" onClick={toggleFullscreen} className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-pill border-0 bg-sand text-ink hover:bg-line" aria-label={full ? "Exit full screen" : "Full screen (F)"} title={full ? "Exit full screen" : "Full screen (F)"}>
            {full ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
          </button>
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
        {/* The sky: what Remi said, and who it was said about. */}
        <section aria-live="polite" aria-label="What Remi said last" className="relative shrink-0 bg-sky text-ink lg:min-h-[44vh]">
          <div className="grid gap-6 px-5 pb-16 pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-12 lg:px-12 lg:pb-20 lg:pt-10">
            <div className="flex min-w-0 flex-col gap-3 lg:gap-4">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-bold text-dusk-deep lg:text-[17px]">
                {lastSpoken ? `Remi said to ${patientName}` : `Remi is with ${patientName}`}
                {lastSpoken ? <span className="font-normal text-ink-soft">{formatTime(lastSpoken.createdAt)}</span> : null}
              </span>
              {lastSpoken ? (
                <p key={lastSpoken.id} className="m-0 max-w-[22ch] animate-arrive text-balance font-display text-[clamp(30px,4.2vw,66px)] font-extrabold leading-[1.1] tracking-tight">
                  &ldquo;{lastSpoken.text}&rdquo;
                </p>
              ) : (
                <p className="m-0 max-w-[24ch] font-display text-[clamp(26px,3.4vw,48px)] font-bold leading-tight text-ink-soft">
                  {loaded ? "Nothing said yet. When someone walks up, their name appears here." : "Connecting"}
                </p>
              )}
            </div>

            {lastSeen?.type === "RECOGNITION" ? (
              <div key={lastSeen.id} className="flex animate-arrive items-center gap-5 lg:flex-col lg:items-end lg:gap-3 lg:text-right">
                <Portrait person={lastPerson} name={lastPerson?.name ?? lastSeen.personName ?? "?"} size={132} className={`border-[5px] border-surface shadow-[0_0_0_4px_var(--color-apricot)] lg:h-[200px] lg:w-[200px] ${inView ? "" : "saturate-[.6] opacity-80"}`} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-bold text-ink-soft lg:text-[17px]">{inView ? "In view" : `Last seen ${formatTime(lastSeen.createdAt)}`}</span>
                  <span className="truncate font-display text-[clamp(28px,3vw,44px)] font-extrabold leading-none">{lastPerson?.name ?? lastSeen.personName ?? "Someone enrolled"}</span>
                  {lastPerson?.relationship ? <span className="font-display text-[clamp(18px,1.6vw,24px)] font-bold text-dusk-deep">{capitalize(lastPerson.relationship)}</span> : null}
                </div>
              </div>
            ) : lastSeen?.type === "UNKNOWN" ? (
              <div key={lastSeen.id} className="flex animate-arrive items-center gap-5 lg:flex-col lg:items-end lg:gap-3 lg:text-right">
                <div className="flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded-pill border-[3px] border-dashed border-dusk/50 bg-surface/50 font-display text-6xl font-extrabold text-dusk-deep lg:h-[200px] lg:w-[200px] lg:text-7xl">
                  ?
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold text-ink-soft lg:text-[17px]">{inView ? "In view" : formatTime(lastSeen.createdAt)}</span>
                  <span className="font-display text-[clamp(28px,3vw,44px)] font-extrabold leading-none">Someone new</span>
                  <span className="text-[17px] text-ink-soft">Not on the list. No name is guessed.</span>
                </div>
              </div>
            ) : null}
          </div>
          {/* The horizon: the sun sits on the line. It lifts gently while the glasses are active. */}
          <div className="pointer-events-none absolute inset-x-0 -bottom-1 flex items-end px-5 lg:px-12">
            <HorizonMark size={88} state={active ? "listening" : "idle"} line="transparent" />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-dusk" aria-hidden="true" />
        </section>

        {/* The ground: recent moments, and the day at a glance. */}
        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)]">
          <section className="flex min-h-[320px] min-w-0 flex-col lg:min-h-0" aria-label="Recent moments">
            <h2 className="m-0 flex items-baseline justify-between px-5 pb-2 pt-5 text-[15px] font-bold text-ink-soft lg:px-12">
              Recent moments
              {loadError && events.length === 0 ? <span className="font-normal text-attention">Could not load ({loadError})</span> : null}
            </h2>
            <ol className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto px-5 pb-6 lg:px-12">
              {loaded && moments.length === 0 && !loadError ? (
                <li className="py-6 text-[17px] text-ink-soft">Nothing yet. Each face, question, answer, and reminder lands here as it happens.</li>
              ) : null}
              {moments.map((m) => (
                <MomentRow key={m.id} m={m} person={m.personId ? people.get(m.personId) : undefined} patientName={patientName} fresh={!!firstIds && !firstIds.has(m.id)} />
              ))}
            </ol>
          </section>

          <aside className="flex flex-col gap-6 border-t border-line px-5 py-5 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:px-8 lg:py-6">
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-[15px] font-bold text-ink-soft">Seen today</h2>
              {seenToday.length === 0 ? (
                <p className="m-0 text-[17px] text-ink-soft">No one yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-4 p-0">
                  {seenToday.slice(0, 8).map((e) => {
                    const p = e.personId ? people.get(e.personId) : undefined;
                    const name = p?.name ?? e.personName ?? "?";
                    return (
                      <li key={e.personId} className="flex w-[72px] flex-col items-center gap-1.5 text-center">
                        <Portrait person={p} name={name} size={56} className="border-[3px] border-surface shadow-[0_0_0_2px_var(--color-apricot)]" />
                        <span className="w-full truncate text-[15px] font-bold">{name.split(" ")[0]}</span>
                        <span className="text-[13px] tabular-nums text-ink-mute">{formatTime(e.createdAt)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-[15px] font-bold text-ink-soft">Coming up</h2>
              {nextUp ? (
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-dusk-mist text-dusk-deep">{nextUp.medicationId ? <PillIcon size={20} /> : <BellIcon size={20} />}</span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-bold tabular-nums text-dusk-deep">{formatTime(nextUp.dueAt)}</span>
                    <span className="text-[17px] leading-snug">{nextUp.text}</span>
                  </div>
                </div>
              ) : (
                <p className="m-0 text-[17px] text-ink-soft">Nothing scheduled.</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-surface px-5 py-2 text-[15px] text-ink-soft">
        <ShieldIcon size={16} className="text-dusk" />
        Faces are matched only against people the family added. Camera frames are never stored.
      </footer>
    </div>
  );
}

function toggleFullscreen() {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

function MomentRow({ m, person, patientName, fresh }: { m: Moment; person?: PersonInfo; patientName: string; fresh: boolean }) {
  const time = <span className="w-[72px] shrink-0 pt-1 text-[15px] font-bold tabular-nums text-ink-soft">{formatTime(m.at)}</span>;
  const row = `flex items-start gap-4 border-b border-line py-3.5 last:border-b-0 ${fresh ? "animate-arrive" : ""}`;
  const quote = (text: string, big = false) => (
    <p className={`m-0 font-display font-bold leading-snug text-dusk-deep ${big ? "text-[20px] lg:text-[22px]" : "text-[18px] lg:text-[19px]"}`}>&ldquo;{text}&rdquo;</p>
  );

  switch (m.kind) {
    case "recognition": {
      const name = person?.name ?? m.personName ?? "Someone enrolled";
      return (
        <li className={row}>
          {time}
          <Portrait person={person} name={name} size={44} className="border-[2px] border-surface shadow-[0_0_0_2px_var(--color-apricot)]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[15px] font-bold text-ink-soft">{m.trigger ? `${patientName} asked who was here` : `${name} walked up`}</span>
            {m.spoken ? quote(m.spoken, true) : <span className="text-[17px]">Recognized {name}.</span>}
          </div>
        </li>
      );
    }
    case "unknown":
      return (
        <li className={row}>
          {time}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border-2 border-dashed border-dusk/40 font-display text-xl font-extrabold text-dusk-deep">?</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[15px] font-bold text-ink-soft">Someone not on the list</span>
            {quote(m.spoken ?? m.text, true)}
          </div>
        </li>
      );
    case "exchange":
      return (
        <li className={row}>
          {time}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-sand text-ink">{m.chat ? <ChatIcon size={22} /> : <QuestionIcon size={22} />}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {m.text ? (
              <div className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink-soft">
                  {m.chat ? `${patientName} said` : `${patientName} asked Remi`}
                  {m.repeat ? <span className="rounded-pill bg-attention-bg px-2 py-0.5 text-[12px] text-attention">Asked again</span> : null}
                </span>
                <span className="text-[18px] leading-snug lg:text-[19px]">{m.text}</span>
              </div>
            ) : null}
            {m.spoken ? (
              <div className="flex flex-col gap-0.5 border-l-[3px] border-dusk-mist-deep pl-3">
                <span className="text-[15px] font-bold text-dusk-deep">Remi</span>
                {quote(m.spoken)}
              </div>
            ) : (
              <span className="text-[15px] text-ink-mute">Remi is thinking</span>
            )}
          </div>
        </li>
      );
    case "reminder":
      return (
        <li className={row}>
          {time}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-dusk-mist text-dusk-deep"><BellIcon size={22} /></span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[15px] font-bold text-ink-soft">Remi reminded {patientName}</span>
            {quote(m.text, true)}
          </div>
        </li>
      );
    case "heard":
      return (
        <li className={row}>
          {time}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-sand text-ink-mute"><ChatIcon size={20} /></span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-bold text-ink-soft">Heard nearby</span>
            <span className="text-[17px] leading-snug text-ink-soft">{m.text}</span>
          </div>
        </li>
      );
    case "remembered":
      return (
        <li className={row}>
          {time}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-apricot-mist text-apricot-deep"><MemoryIcon size={22} /></span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-bold text-ink-soft">Remember{m.personName ? `, with ${m.personName}` : ""}</span>
            <span className="text-[17px] leading-snug">{m.text}</span>
          </div>
        </li>
      );
    default:
      return (
        <li className={row}>
          {time}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-dusk-mist">{m.personId ? <PersonIcon size={22} className="text-dusk-deep" /> : <HorizonMark size={24} />}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[15px] font-bold text-ink-soft">{m.trigger ? `${patientName} asked who was here` : m.chat ? "Remi said in conversation" : "Remi said"}</span>
            {quote(m.text, true)}
          </div>
        </li>
      );
  }
}
