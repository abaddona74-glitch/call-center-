'use client';

import React from 'react';
import { ArchitectureNode, CLUSTERS } from '@/data/architecture';

interface HudTooltipProps {
  node: ArchitectureNode | null;
  connectionCount?: number;
}

export default function HudTooltip({ node, connectionCount = 0 }: HudTooltipProps) {
  if (!node) return null;

  const cluster = CLUSTERS[node.group];

  return (
    <div
      style={{
        position: 'absolute',
        top: '24px',
        right: '24px',
        width: '320px',
        background: 'rgba(5, 6, 10, 0.88)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${node.color}66`,
        boxShadow: `0 0 25px ${node.color}22, inset 0 0 15px ${node.color}11`,
        borderRadius: '8px',
        padding: '16px',
        color: '#f8fafc',
        fontFamily: 'JetBrains Mono, monospace',
        zIndex: 40,
        pointerEvents: 'none',
        transition: 'all 0.2s ease-in-out'
      }}
    >
      {/* Sci-fi header line */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${node.color}33`,
          paddingBottom: '8px',
          marginBottom: '10px'
        }}
      >
        <span
          style={{
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            color: node.color,
            fontWeight: 700
          }}
        >
          NODE_TELEMETRY // {node.group}
        </span>
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: node.color,
            boxShadow: `0 0 8px ${node.color}`
          }}
        />
      </div>

      {/* Node Title */}
      <h3
        style={{
          fontSize: '15px',
          fontWeight: 700,
          color: '#ffffff',
          margin: '0 0 8px 0',
          letterSpacing: '0.5px'
        }}
      >
        {node.label}
      </h3>

      {/* Meta Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
        {node.port && (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '4px',
              color: '#38bdf8'
            }}
          >
            PORT: {node.port}
          </span>
        )}
        {node.protocol && (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              borderRadius: '4px',
              color: '#c084fc'
            }}
          >
            {node.protocol}
          </span>
        )}
        {node.host && (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              background: 'rgba(234, 179, 8, 0.15)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: '4px',
              color: '#facc15'
            }}
          >
            HOST: {node.host}
          </span>
        )}
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '4px',
            color: '#4ade80'
          }}
        >
          {connectionCount} LINKS
        </span>
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#cbd5e1',
          margin: 0
        }}
      >
        {node.description}
      </p>
    </div>
  );
}
