import { ShieldIcon } from "./icons";

export function PrivacyFooter() {
  return (
    <footer className="flex items-center gap-2 border-t border-sand pt-5 text-sm text-ink-soft">
      <ShieldIcon size={16} className="shrink-0 text-harbor" />
      <span>Faces are matched only against people you enroll. Camera frames are never stored.</span>
    </footer>
  );
}
