import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import SessionWrapper from "@/components/SessionWrapper";

export const metadata: Metadata = {
  title: "Roam Growth Engine",
  description: "CRM and growth platform for Roam Local",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      </head>
      <body style={{ margin: 0, background: '#f7f3f4' }}>
        <SessionWrapper>
          <Sidebar/>
          <main style={{ marginLeft: 240, minHeight: '100vh' }}>
            {children}
          </main>
        </SessionWrapper>
      </body>
    </html>
  );
}
