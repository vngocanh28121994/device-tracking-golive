import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kho Vui Vẻ — Quản lý thiết bị",
  description: "Theo dõi thiết bị, người giữ và chốt tình trạng mỗi ngày.",
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
