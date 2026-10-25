import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Nunito } from "next/font/google";
import "./globals.css";

// latin-ext carries the dotless ı the wordmark is set with.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700", "800"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: { default: "Remi", template: "%s · Remi" },
  description: "Remi is a gentle memory companion that speaks through Ray-Ban Meta glasses, with a dashboard for the people who care.",
};

/**
 * Picks the sky before first paint from the viewer's clock: dawn 5 to 9, day 9 to 16, evening
 * 16 to 20, night otherwise. Mirrors `skyPeriod` in the phone app's theme. Runs inline so static
 * pages stay static and nothing flashes from one sky to another.
 */
const SKY_SCRIPT =
  "(function(){var h=new Date().getHours();document.documentElement.dataset.sky=h>=5&&h<9?'dawn':h>=9&&h<16?'day':h>=16&&h<20?'evening':'night'})()";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-sky="dawn" className={`${nunito.variable} ${atkinson.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SKY_SCRIPT }} />
      </head>
      <body className="min-h-full bg-linen font-body text-ink">{children}</body>
    </html>
  );
}
