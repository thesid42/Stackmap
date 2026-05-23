import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StackMap",
  description: "AI onboarding workspace for codebases and microservice platforms"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
