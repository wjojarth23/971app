import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
import { Roboto } from "next/font/google";

const roboto = Roboto({
  subsets: ["latin"],
  variable: "--font-roboto",
  display: "swap",
});
const zalando = localFont({
  src: "../public/index/ZalandoSansExpanded-VariableFont_wght.ttf",
  variable: "--font-zalando",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AutoCAM",
  description: "AutoCAM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
        />
      </head>
      <body
        className={
          "text-foreground " + zalando.variable + " " + roboto.variable
        }
      >
        {children}
      </body>
    </html>
  );
}
