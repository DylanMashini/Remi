"use client";

import { useState } from "react";
import { PlayIcon } from "../icons";

/** Plays the introduction line with the browser voice, as a preview of what the glasses say. */
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
      className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-sand px-3 text-sm font-bold text-ink hover:bg-line"
      aria-label={`Play preview: ${text}`}
    >
      <PlayIcon size={14} />
      {playing ? "Playing" : "Play"}
    </button>
  );
}
