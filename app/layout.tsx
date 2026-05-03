import type { Metadata, Viewport } from "next";
import "./globals.css";
import LayoutShell from "@/components/LayoutShell";
import SessionWrapper from "@/components/SessionWrapper";

export const metadata: Metadata = {
  title: "Roam Growth Engine",
  description: "CRM and growth platform for Roam Local",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      </head>
      <body style={{ margin: 0, background: '#f7f3f4' }}>
        <SessionWrapper>
          <LayoutShell>{children}</LayoutShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
