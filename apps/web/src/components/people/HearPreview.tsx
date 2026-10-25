"use client";

import { useState } from "react";
import { PlayIcon } from "../icons";

/** Plays the line with the browser voice, as a preview of what Remi says. */
export function HearPreview({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);

  function play() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    setPlaying(true);
    window.speechSynthesis.speak(u);
  }

  return (
    <button
      type="button"
      onClick={play}
      className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-surface px-3 text-[14px] font-bold text-dusk-deep shadow-[0_0_0_1.5px_var(--color-dusk-mist-deep)] hover:bg-dusk-mist"
      aria-label={`Hear a preview: ${text}`}
      aria-pressed={playing}
    >
      <PlayIcon size={14} />
      {playing ? "Playing" : "Hear it"}
    </button>
  );
}
