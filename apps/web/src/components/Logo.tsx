/*
 * The Remi brand, in three pieces that are only ever drawn here (mirrors
 * apps/mobile/src/components/brand.tsx):
 *
 * - `HorizonMark`: a sun half-risen over a line. The favicon, the avatar beside everything Remi
 *   says, and the listening indicator are all this one mark.
 * - `Wordmark`: "remi" in Nunito 800, lowercase, with the sun as the dot of the i. Real type (a
 *   dotless ı), so it sets like text at any size and never blurs.
 * - The sky lives in CSS (`bg-sky`, keyed by `data-sky` on <html>) because it needs no JS.
 *
 * Server-safe: no hooks.
 */

type MarkProps = {
  /** Width of the horizon line. The sun is 62% of it. */
  size?: number;
  /** idle: half-risen and still. listening: the sun lifts and settles. rising: one sunrise. */
  state?: "idle" | "listening" | "rising";
  className?: string;
  /** CSS color for the line. Defaults to dusk; night text on the viewfinder. */
  line?: string;
};

export function HorizonMark({ size = 24, state = "idle", className = "", line = "var(--color-dusk)" }: MarkProps) {
  const d = size * 0.62;
  const r = d / 2;
  const t = Math.max(2, Math.round(size * 0.09));
  const motion = state === "listening" ? "animate-breathe" : state === "rising" ? "animate-sunrise" : "";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 flex-col items-center ${className}`}
      style={{ width: size, height: r + t }}
    >
      <span className="block overflow-hidden" style={{ width: d, height: r }}>
        <span className={`block rounded-full bg-sun ${motion}`} style={{ width: d, height: d }} />
      </span>
      <span className="block" style={{ width: size, height: t, borderRadius: t / 2, background: line }} />
    </span>
  );
}

/**
 * "remi", set in Nunito 800 with the sun as the dot of the i.
 *
 * Nunito's metrics (1000/em): the ı stem is centred at 0.1335em and its top at 0.499em. With
 * line-height 1 the baseline sits 0.829em below the top of the line box. The half-disc is 0.26em
 * wide and its flat edge sits 0.555em above the baseline, a sun just clearing the stem.
 */
export function Wordmark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Remi"
      className={`inline-flex items-start font-display font-extrabold leading-none text-dusk ${className}`}
      style={{ fontSize: size, letterSpacing: "-0.02em" }}
    >
      <span>rem</span>
      <span className="relative">
        ı
        <span
          aria-hidden="true"
          className="absolute block bg-sun"
          style={{
            left: "0.0035em",
            top: `${0.829 - 0.555 - 0.13}em`,
            width: "0.26em",
            height: "0.13em",
            borderRadius: "0.13em 0.13em 0 0",
          }}
        />
      </span>
    </span>
  );
}
