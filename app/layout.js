import "./globals.css";

export const metadata = {
  title: "Weather Dashboard | Internal",
  description: "Internal weather and lead flow analytics dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
