import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quản lý thiết bị",
  description: "Quản lý từng thiết bị, người đang giữ và lịch sử bàn giao trong đội.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
