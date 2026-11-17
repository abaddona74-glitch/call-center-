'use client';

import React from 'react';
import { ArchitectureNode } from '@/data/architecture';

interface StatusBarProps {
  focusedNode: ArchitectureNode | null;
  connectionCount?: number;
  totalNodes: number;
  totalLinks: number;
}

export default function StatusBar({
  focusedNode,
  connectionCount = 0,
  totalNodes,
  totalLinks
}: StatusBarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        background: 'rgba(5, 6, 10, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(124, 108, 255, 0.25)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
        borderRadius: '6px',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '12px',
        color: '#94a3b8',
        zIndex: 40,
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: '#10b981',
          boxShadow: '0 0 8px #10b981'
        }}
      />
      <span>SYSTEM // GALAXY_MAP</span>
      <span style={{ color: '#475569' }}>|</span>
      {focusedNode ? (
        <span style={{ color: '#f8fafc' }}>
          focus :: <strong style={{ color: focusedNode.color }}>{focusedNode.id}</strong> ::{' '}
          <span style={{ color: '#38bdf8' }}>{connectionCount} connections</span>
        </span>
      ) : (
        <span>
          galaxy status :: ready :: <span style={{ color: '#38bdf8' }}>{totalNodes} nodes</span> ::{' '}
          <span style={{ color: '#a855f7' }}>{totalLinks} links</span>
        </span>
      )}
    </div>
  );
}
