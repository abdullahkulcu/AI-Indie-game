import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demirkale — Krallık Simülasyonu",
  description: "Generalinizle konuşarak yaşayan bir ortaçağ krallığını yönetin.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
