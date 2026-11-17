'use client';

import React from 'react';
import { CLUSTERS, ClusterId } from '@/data/architecture';

interface FilterBarProps {
  selectedCluster: ClusterId | null;
  onSelectCluster: (cluster: ClusterId | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onResetView?: () => void;
}

export default function FilterBar({
  selectedCluster,
  onSelectCluster,
  searchQuery,
  onSearchChange,
  onResetView
}: FilterBarProps) {
  const clusterList = Object.values(CLUSTERS);

  return (
    <div
      style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
        background: 'rgba(5, 6, 10, 0.85)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
        borderRadius: '8px',
        padding: '10px 14px',
        zIndex: 40,
        fontFamily: 'JetBrains Mono, monospace'
      }}
    >
      {/* Brand Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          paddingRight: '12px',
          borderRight: '1px solid rgba(255, 255, 255, 0.12)',
          marginRight: '4px'
        }}
      >
        <span
          style={{
            fontSize: '13px',
            fontWeight: 800,
            letterSpacing: '1px',
            color: '#7c6cff'
          }}
        >
          CALL CENTER // 3D MAP
        </span>
      </div>

      {/* Cluster Pill Filters */}
      <button
        onClick={() => onSelectCluster(null)}
        style={{
          fontSize: '11px',
          fontWeight: 600,
          padding: '5px 10px',
          borderRadius: '4px',
          border: selectedCluster === null ? '1px solid #7c6cff' : '1px solid rgba(255, 255, 255, 0.15)',
          background: selectedCluster === null ? 'rgba(124, 108, 255, 0.25)' : 'transparent',
          color: selectedCluster === null ? '#ffffff' : '#94a3b8',
          cursor: 'pointer',
          transition: 'all 0.15s'
        }}
      >
        ALL CLUSTERS
      </button>

      {clusterList.map((cluster) => {
        const isActive = selectedCluster === cluster.id;
        return (
          <button
            key={cluster.id}
            onClick={() => onSelectCluster(isActive ? null : cluster.id)}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '5px 10px',
              borderRadius: '4px',
              border: isActive ? `1px solid ${cluster.color}` : '1px solid rgba(255, 255, 255, 0.1)',
              background: isActive ? `${cluster.color}28` : 'transparent',
              color: isActive ? '#ffffff' : cluster.color,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s'
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: cluster.color,
                boxShadow: isActive ? `0 0 6px ${cluster.color}` : 'none'
              }}
            />
            {cluster.name}
          </button>
        );
      })}

      {/* Search Input */}
      <div style={{ marginLeft: '6px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter node by name..."
          style={{
            background: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '4px',
            color: '#f8fafc',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono, monospace',
            padding: '5px 10px',
            width: '180px',
            outline: 'none'
          }}
        />
      </div>
    </div>
  );
}
