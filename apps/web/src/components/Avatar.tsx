import { initials } from "./format";

/** Person avatar via the authed file route, with an apricot initials fallback. */
export function Avatar({
  name,
  avatarFileId,
  size = 44,
  className = "",
}: {
  name: string;
  avatarFileId?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (avatarFileId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authed route, not optimizable
      <img
        src={`/api/files/${avatarFileId}`}
        alt=""
        style={style}
        className={`shrink-0 rounded-pill bg-apricot object-cover ${className}`}
      />
    );
  }
  return (
    <div
      style={style}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-pill bg-apricot font-display font-extrabold text-ink ${className}`}
    >
      {initials(name)}
    </div>
  );
}
