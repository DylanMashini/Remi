import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Base {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></Base>
);
export const PeopleIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 14c2.4 0 4 1.6 4.5 4" />
  </Base>
);
export const CalendarIcon = (p: IconProps) => (
  <Base {...p}><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Base>
);
export const LiveIcon = (p: IconProps) => (
  <Base {...p}><circle cx="6.5" cy="13" r="3.5" /><circle cx="17.5" cy="13" r="3.5" /><path d="M10 13h4M3 13V9M21 13V9" /></Base>
);
export const CheckIcon = (p: IconProps) => (
  <Base strokeWidth={2.4} {...p}><path d="M5 12l5 5L20 7" /></Base>
);
export const PersonIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Base>
);
export const ChatIcon = (p: IconProps) => (
  <Base {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Base>
);
export const QuestionIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></Base>
);
export const AnswerIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h8M8 13h5" /></Base>
);
export const BellIcon = (p: IconProps) => (
  <Base {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></Base>
);
export const SpeakerIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></Base>
);
export const TrashIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Base>
);
export const PlayIcon = (p: IconProps) => (
  <Base {...p}><path d="M7 5l12 7-12 7z" /></Base>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Base {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Base>
);
export const ShieldIcon = (p: IconProps) => (
  <Base {...p}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /></Base>
);
export const MemoryIcon = (p: IconProps) => (
  <Base {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="10.5" r="2.5" /><path d="M7.5 17c.8-2 2.4-3 4.5-3s3.7 1 4.5 3" /></Base>
);
export const MicIcon = (p: IconProps) => (
  <Base {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Base>
);
export const PencilIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" /><path d="M13.5 7.5l3 3" /></Base>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Base strokeWidth={2.4} {...p}><path d="M9 6l6 6-6 6" /></Base>
);
export const PlusIcon = (p: IconProps) => (
  <Base strokeWidth={2.4} {...p}><path d="M12 5v14M5 12h14" /></Base>
);
export const XIcon = (p: IconProps) => (
  <Base strokeWidth={2.4} {...p}><path d="M6 6l12 12M18 6L6 18" /></Base>
);
export const GlassesIcon = (p: IconProps) => (
  <Base {...p}><circle cx="6.5" cy="14" r="3.5" /><circle cx="17.5" cy="14" r="3.5" /><path d="M10 14h4M3 14l1.5-5.5A1.5 1.5 0 0 1 6 7.5h1M21 14l-1.5-5.5A1.5 1.5 0 0 0 18 7.5h-1" /></Base>
);
export const InsightsIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 19h16M7 16V10M12 16V5M17 16v-3" /></Base>
);
export const SettingsIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2" /></Base>
);
export const EyeOffIcon = (p: IconProps) => (
  <Base {...p}><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c5 0 8.5 4 9.5 7-.4 1.1-1.1 2.3-2.1 3.4M6.6 6.6C4.5 8 3.1 10 2.5 12c1 3 4.5 7 9.5 7 1.6 0 3-.4 4.3-1" /></Base>
);
export const SunIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Base>
);
/** The brand's own glyph for Today: a sun half-risen over the horizon. */
export const SunriseIcon = (p: IconProps) => (
  <Base {...p}><path d="M5 15a7 7 0 0 1 14 0" /><path d="M2 19h20M12 3v3M4.2 7.2l2.1 2.1M19.8 7.2l-2.1 2.1" /></Base>
);
export const HeartIcon = (p: IconProps) => (
  <Base {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></Base>
);
export const CameraIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 8h3l2-3h6l2 3h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></Base>
);
export const ClockIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Base>
);
export const PhoneIcon = (p: IconProps) => (
  <Base {...p}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18h2" /></Base>
);
export const LockIcon = (p: IconProps) => (
  <Base {...p}><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Base>
);
export const LogOutIcon = (p: IconProps) => (
  <Base {...p}><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l5 4-5 4M20 12H9" /></Base>
);
/** A capsule, tilted: the medication tool. */
export const PillIcon = (p: IconProps) => (
  <Base {...p}><rect x="8" y="2.5" width="8" height="19" rx="4" /><path d="M8 12h8" /><path d="M8 6.5a4 4 0 0 1 8 0V12H8z" fill="currentColor" stroke="none" /></Base>
);
export const MaximizeIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Base>
);
export const MinimizeIcon = (p: IconProps) => (
  <Base {...p}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Base>
);
export const LinkIcon = (p: IconProps) => (
  <Base {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></Base>
);
export const CopyIcon = (p: IconProps) => (
  <Base {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Base>
);
export const RepeatIcon = (p: IconProps) => (
  <Base {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></Base>
);
