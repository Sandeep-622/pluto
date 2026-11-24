import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pluto | Your medical reading companion",
  description: "Explore your medical books with grounded answers and clear sources.",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
