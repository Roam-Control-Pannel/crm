import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roam Growth Engine",
  description: "CRM and growth platform for Roam Local",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
