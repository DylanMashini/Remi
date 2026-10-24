import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Recall",
  description: "A gentle memory companion on Ray-Ban Meta glasses, with a caregiver dashboard.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} ${atkinson.variable} h-full antialiased`}>
      <body className="min-h-full bg-linen font-body text-ink">{children}</body>
    </html>
  );
}
