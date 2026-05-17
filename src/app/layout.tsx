import type { Metadata } from "next";
import { Titillium_Web } from "next/font/google";
import "./globals.css";

const titillium = Titillium_Web({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  variable: "--font-titillium",
  display: "swap",
});

export const metadata: Metadata = {
  title: "List of Open Points Tracker",
  description:
    "Draft status-inquiry emails for delayed items in a project's List of Open Points.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${titillium.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[var(--font-titillium)]">
        {children}
      </body>
    </html>
  );
}
