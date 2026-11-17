import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Call Center Enterprise // 3D Architecture Galaxy',
  description: 'Interactive 3D Force Graph Topology of Call Center Infrastructure',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uz">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#05060a',
          color: '#f8fafc',
          fontFamily: "'JetBrains Mono', Courier, monospace",
          overflow: 'hidden',
          width: '100vw',
          height: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
