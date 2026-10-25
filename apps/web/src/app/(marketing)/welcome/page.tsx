import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { BellIcon, EyeOffIcon, PeopleIcon, PersonIcon, QuestionIcon, TrashIcon } from "@/components/icons";
import { HorizonMark, Wordmark } from "@/components/Logo";
import { buttonLarge, buttonSecondary, buttonText, Row, RowIcon, Spoken } from "@/components/ui";

export const metadata: Metadata = {
  title: { absolute: "Remi" },
  description:
    "Remi is a memory companion that lives in a pair of Ray-Ban Meta glasses. It quietly says who is here, what was just said, and what comes next, and gives the family a calm view of the day.",
};

/*
 * The public front door. Visitors without a session land here from "/" (see src/proxy.ts).
 *
 * The hero is the phone's "words" surface at page scale: the sky of the hour, the line Remi
 * said, and the horizon along the bottom edge with the sun half-risen on it. It is the one place
 * on this page that carries the gradient. Everything below is flat linen and white and reuses the
 * dashboard kit, so the page looks like the product it is selling.
 */

const QUESTIONS: { asks: string; says: string; how: string }[] = [
  {
    asks: "Who is this?",
    says: "This is Sarah, your daughter. She’s here to help with the garden.",
    how: "Faces are matched on the phone against the people the family has added, and Remi speaks within two seconds. An unfamiliar face is “Someone new is here”. A name is never guessed.",
  },
  {
    asks: "What were we talking about?",
    says: "You and Sarah were talking about the tomatoes. She’s bringing seedlings on Saturday.",
    how: "Remi hears the conversation through the glasses and answers from the last few minutes of it. Ask with a tap, the button on the glasses, or by saying “Hey Remi”.",
  },
  {
    asks: "Where am I, and what’s next?",
    says: "You’re at home. Lunch with Tom is at noon, in about an hour.",
    how: "Orientation whenever it is asked for. Reminders and medication times the family sets are spoken on their own, at the right moment, without anyone asking.",
  },
];

const FAMILY: { title: string; detail: string }[] = [
  {
    title: "People",
    detail: "Add family and friends with three photos, a relationship, and the one note Remi should mention.",
  },
  {
    title: "Today",
    detail: "A timeline of who came by, what was asked, and what Remi said, updated as it happens.",
  },
  {
    title: "Reminders and medication",
    detail: "Set them once here. Remi speaks them at the right moment, and the timeline shows they were heard.",
  },
  {
    title: "Family invites",
    detail: "Everyone who helps gets their own sign-in to the same account, on the web and on the phone.",
  },
];

export default function WelcomePage() {
  return (
    <>
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" className="flex items-center no-underline" aria-label="Remi home">
          <Wordmark size={28} />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2 sm:gap-4">
          <Link href="/login" className={`${buttonText} text-[16px]`}>
            Sign in
          </Link>
          {/* Wrapper, not a display utility on the link: the button kit already sets display. */}
          <span className="hidden sm:block">
            <Link href="/signup" className={`${buttonSecondary} h-11 px-4 text-[16px]`}>
              Create an account
            </Link>
          </span>
        </nav>
      </header>

      <main className="flex flex-col">
        <Hero />

        <Section
          title="Three questions, asked many times a day."
          lead="Ruth wears the glasses; her family added Sarah and Tom. Remi answers each question the same way every time, in the same words. Nothing is corrected and nothing is quizzed. Consistency is comfort."
        >
          <div className="grid overflow-hidden rounded-md bg-surface md:grid-cols-3">
            {QUESTIONS.map((q, i) => (
              <article
                key={q.asks}
                className={`flex flex-col gap-5 p-6 sm:p-7 ${i > 0 ? "border-t border-hairline md:border-l md:border-t-0" : ""}`}
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-[15px] font-bold text-ink-soft">Ruth asks</span>
                  <p className="m-0 text-[21px] leading-snug text-ink">“{q.asks}”</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-[15px] font-bold text-dusk-deep">
                    <HorizonMark size={18} />
                    Remi says
                  </span>
                  <Spoken size="sm">{q.says}</Spoken>
                </div>
                <p className="m-0 mt-auto text-[15px] leading-snug text-ink-mute">{q.how}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section
          title="The family sees the day. Not a camera."
          lead="Remi comes with a place for the people who care. This website and the phone app share one account, so whoever is nearby can help."
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
            <ul className="m-0 flex list-none flex-col gap-5 p-0">
              {FAMILY.map((f) => (
                <li key={f.title} className="flex flex-col gap-1">
                  <span className="text-[17px] font-bold text-ink">{f.title}</span>
                  <span className="text-[15px] leading-snug text-ink-soft">{f.detail}</span>
                </li>
              ))}
            </ul>
            <SampleTimeline />
          </div>
        </Section>

        <Section
          title="Private by design, not by setting."
          lead="These cannot be turned off. Signed-in families see this same list with live counts of exactly what Remi keeps, so they can check it themselves."
        >
          <div className="hairline-rows max-w-[880px] overflow-hidden rounded-md bg-surface">
            <Row
              leading={
                <RowIcon tone="dusk" size={44}>
                  <PeopleIcon size={22} />
                </RowIcon>
              }
              title="Only the people you add are recognized"
              detail="Faces are compared against your family’s roster and no one else. There is no search of strangers. An unknown face is announced as “Someone new is here” and no name is ever guessed."
            />
            <Row
              leading={
                <RowIcon tone="dusk" size={44}>
                  <EyeOffIcon size={22} />
                </RowIcon>
              }
              title="Camera frames never leave the phone"
              detail="Faces are matched on the phone itself. Each frame is checked and discarded; the server only ever learns who was matched and when. There is no video, no gallery, and no live feed for anyone to watch."
            />
            <Row
              leading={
                <RowIcon tone="dusk" size={44}>
                  <TrashIcon size={22} />
                </RowIcon>
              }
              title="Every moment can be deleted"
              detail="Only moments are kept: who, when, what was said. Any one of them can be removed, permanently and right away. Removing a person also deletes their photos and face data."
            />
          </div>
        </Section>

        <section className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-4 sm:px-6 sm:pb-24">
          <div className="flex flex-col gap-6 border-t border-sand pt-10 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex max-w-[52ch] flex-col gap-2">
              <h2 className="m-0 font-display text-[28px] font-extrabold leading-[1.12] tracking-[-0.5px] sm:text-[32px]">
                Set up Remi for someone you love.
              </h2>
              <p className="m-0 text-[17px] leading-relaxed text-ink-soft">
                Create an account, add the first few people, and pair the glasses in the phone app. It takes a few minutes.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Link href="/signup" className={`${buttonLarge} whitespace-nowrap`}>
                Create an account
              </Link>
              <Link href="/login" className={`${buttonText} text-[17px]`}>
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-sand bg-surface">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-8 text-[15px] text-ink-soft sm:px-6">
          <Wordmark size={22} />
          <span>Built at HackPSU, October 2026, for people living with dementia and the people who love them.</span>
        </div>
      </footer>
    </>
  );
}

/**
 * The sky card. Text sits in the sky in ink, as on the phone; the sun comes up once from behind
 * the horizon on first paint (reduced motion shows it already risen).
 */
function Hero() {
  const sun = { "--sun": "clamp(150px, 24vw, 320px)" } as CSSProperties;
  return (
    <section className="px-4 sm:px-6 lg:px-10" aria-labelledby="hero-title">
      <div
        style={sun}
        className="relative mx-auto flex min-h-[min(78dvh,820px)] w-full max-w-[1280px] flex-col justify-center overflow-hidden rounded-lg bg-sky px-6 pb-[calc(var(--sun)/2+36px)] pt-10 sm:px-12 sm:pt-14 lg:px-16 lg:pb-16 lg:pt-16"
      >
        <div className="relative z-10 flex max-w-[760px] flex-col gap-7">
          <span className="flex items-center gap-2 text-[15px] font-bold text-dusk-deep sm:text-[16px]">
            <HorizonMark size={18} />
            Remi said at 2:14 PM
          </span>
          <h1
            id="hero-title"
            className="m-0 font-display text-[clamp(34px,5.4vw,66px)] font-extrabold leading-[1.08] tracking-[-0.025em] text-ink"
          >
            “This is Sarah, your daughter. She’s here to help with the garden.”
          </h1>
          <p className="m-0 max-w-[54ch] text-[18px] leading-[1.5] text-ink-soft sm:text-[21px]">
            Remi lives in a pair of Ray-Ban Meta glasses. It quietly says who is here, what was just said, and what
            comes next. Nothing to read, nothing to learn.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href="/signup" className={buttonLarge}>
              Create an account
            </Link>
            <Link href="/login" className={`${buttonSecondary} h-14 px-6 text-[18px]`}>
              Sign in
            </Link>
          </div>
        </div>

        {/* The horizon: a dusk line along the bottom edge, with the sun half-risen behind it. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="absolute bottom-[3px] right-[7%] h-[calc(var(--sun)/2)] w-[var(--sun)] overflow-hidden">
            <div className="h-[var(--sun)] w-[var(--sun)] animate-sunrise rounded-full bg-sun" />
          </div>
          <div className="h-[3px] w-full bg-dusk" />
        </div>
      </div>
    </section>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[1120px] px-4 pt-16 sm:px-6 sm:pt-24">
      <div className="flex flex-col gap-3">
        <h2 className="m-0 max-w-[36ch] font-display text-[30px] font-extrabold leading-[1.12] tracking-[-0.6px] sm:text-[38px]">
          {title}
        </h2>
        <p className="m-0 max-w-[62ch] text-[17px] leading-relaxed text-ink-soft sm:text-[18px]">{lead}</p>
      </div>
      <div className="mt-8 sm:mt-10">{children}</div>
    </section>
  );
}

/** A few rows of a Today timeline, built from the dashboard's own Row so it looks like the real thing. */
function SampleTimeline() {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 px-1 text-[15px] font-bold text-ink-soft">Today, as the family sees it</h3>
      <div className="hairline-rows overflow-hidden rounded-md bg-surface">
        <Row
          leading={
            <RowIcon tone="sand" size={40}>
              <QuestionIcon size={20} />
            </RowIcon>
          }
          title="Ruth asked Remi"
          detail="“What were we talking about?” Remi answered from the last three minutes."
          value="2:31 PM"
          valueTone="mute"
        />
        <Row
          leading={
            <RowIcon tone="dusk" size={40}>
              <HorizonMark size={20} />
            </RowIcon>
          }
          title="Remi said"
          detail="“This is Sarah, your daughter. She’s here to help with the garden.”"
          value="2:14 PM"
          valueTone="mute"
        />
        <Row
          leading={
            <RowIcon tone="apricot" size={40}>
              <PersonIcon size={20} />
            </RowIcon>
          }
          title="Recognized Sarah"
          detail="Daughter. Second visit this week."
          value="2:14 PM"
          valueTone="mute"
        />
        <Row
          leading={
            <RowIcon tone="dusk" size={40}>
              <BellIcon size={20} />
            </RowIcon>
          }
          title="Remi reminded"
          detail="“Lunch with Tom is at noon.” Heard on the glasses."
          value="11:45 AM"
          valueTone="mute"
        />
      </div>
      <p className="m-0 px-1 text-[15px] leading-snug text-ink-mute">Moments only. No frames, no audio recordings, no location.</p>
    </div>
  );
}
