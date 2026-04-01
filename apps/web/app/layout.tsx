import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic",
  description: "A policy-aware agentic operations layer with a reproducible Word specification."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
