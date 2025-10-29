import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pest Control Weather Dashboard",
  description: "Weather analytics and lead correlation dashboard for pest control",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
