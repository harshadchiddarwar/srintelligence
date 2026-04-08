import type { Metadata } from "next";
import "./globals.css";
import TopBar from "@/components/layout/TopBar";
import ResizableLayout from "@/components/layout/ResizableLayout";

export const metadata: Metadata = {
  title: "SRIntelligence™",
  description: "AI-powered pharmaceutical analytics platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col overflow-hidden" style={{ background: "var(--bg-primary)" }}>
        <TopBar />
        <ResizableLayout>{children}</ResizableLayout>
      </body>
    </html>
  );
}
