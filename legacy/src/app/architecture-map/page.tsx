'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  architectureData,
  ArchitectureNode,
  ClusterId
} from '@/data/architecture';
import HudTooltip from '@/components/HudTooltip';
import StatusBar from '@/components/StatusBar';
import FilterBar from '@/components/FilterBar';

// Dynamic import with ssr: false as required for Three.js WebGL canvas
const ArchitectureGraph = dynamic(() => import('@/components/ArchitectureGraph'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#05060a',
        color: '#7c6cff',
        fontFamily: 'JetBrains Mono, monospace',
        gap: '16px'
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          border: '3px solid rgba(124, 108, 255, 0.2)',
          borderTopColor: '#7c6cff',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}
      />
      <div style={{ letterSpacing: '2px', fontSize: '13px' }}>
        INITIALIZING 3D STAR MAP TELEMETRY...
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
});

export default function ArchitectureMapPage() {
  const [hoveredNode, setHoveredNode] = useState<ArchitectureNode | null>(null);
  const [focusedNode, setFocusedNode] = useState<ArchitectureNode | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterId | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Active node for display in HUD (hovered takes priority, otherwise focused)
  const activeNode = hoveredNode || focusedNode;

  // Compute connections count for the active node
  const activeNodeConnectionCount = useMemo(() => {
    if (!activeNode) return 0;
    return architectureData.links.filter((l) => {
      const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;
      return srcId === activeNode.id || tgtId === activeNode.id;
    }).length;
  }, [activeNode]);

  return (
    <main
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#05060a'
      }}
    >
      {/* Top Filter and Search Bar */}
      <FilterBar
        selectedCluster={selectedCluster}
        onSelectCluster={setSelectedCluster}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main 3D Force Graph */}
      <ArchitectureGraph
        selectedCluster={selectedCluster}
        searchQuery={searchQuery}
        onNodeClick={(node) => setFocusedNode(node)}
        onNodeHover={(node) => setHoveredNode(node)}
      />

      {/* Top-Right Sci-Fi HUD Tooltip */}
      <HudTooltip
        node={activeNode}
        connectionCount={activeNodeConnectionCount}
      />

      {/* Bottom-Left Status Bar */}
      <StatusBar
        focusedNode={activeNode}
        connectionCount={activeNodeConnectionCount}
        totalNodes={architectureData.nodes.length}
        totalLinks={architectureData.links.length}
      />
    </main>
  );
}
