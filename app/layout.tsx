import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team party",
  description: "Quản lý từng thiết bị, người đang giữ và lịch sử bàn giao trong đội.",
  icons: {
    // The tab icon is the light tile in every colour scheme.
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon-light-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

// Applied before first paint so a dark-mode visitor never sees a light flash.
// A saved choice wins; otherwise the operating system preference decides.
const themeScript = `try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
