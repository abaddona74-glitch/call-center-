'use client';

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import {
  architectureData,
  ArchitectureNode,
  ArchitectureLink,
  CLUSTERS,
  ClusterId
} from '@/data/architecture';

interface ArchitectureGraphProps {
  onNodeClick?: (node: ArchitectureNode) => void;
  onNodeHover?: (node: ArchitectureNode | null) => void;
  selectedCluster?: ClusterId | null;
  searchQuery?: string;
}

export default function ArchitectureGraph({
  onNodeClick,
  onNodeHover,
  selectedCluster = null,
  searchQuery = ''
}: ArchitectureGraphProps) {
  const fgRef = useRef<ForceGraphMethods<ArchitectureNode, ArchitectureLink> | undefined>(undefined);

  // Filtered graph data according to active cluster filter and search query
  const graphData = useMemo(() => {
    let nodes = architectureData.nodes;
    if (selectedCluster) {
      nodes = nodes.filter((n) => n.group === selectedCluster);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      nodes = nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          n.description.toLowerCase().includes(q) ||
          (n.port && n.port.toLowerCase().includes(q))
      );
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = architectureData.links.filter((l) => {
      const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;
      return nodeIds.has(srcId) && nodeIds.has(tgtId);
    });

    return { nodes, links };
  }, [selectedCluster, searchQuery]);

  // Initial camera setup and slow orbit rotation
  useEffect(() => {
    if (!fgRef.current) return;
    const fg = fgRef.current;

    // Set initial camera distance
    fg.cameraPosition({ x: 0, y: 150, z: 450 });

    // Slow organic camera rotation around the galaxy
    let angle = 0;
    const distance = 460;
    let animId: number;

    const orbit = () => {
      angle += 0.0012;
      const camera = fg.camera();
      if (camera) {
        // Orbit if not manually dragging
        camera.position.x = distance * Math.sin(angle);
        camera.position.z = distance * Math.cos(angle);
        camera.lookAt(0, 0, 0);
      }
      animId = requestAnimationFrame(orbit);
    };

    // Delay auto-orbit slightly so initial force layout settles
    const timer = setTimeout(() => {
      animId = requestAnimationFrame(orbit);
    }, 1500);

    return () => {
      clearTimeout(timer);
      if (animId) cancelAnimationFrame(animId);
    };
  }, []);

  // Custom 3D Object for each node: Core sphere + outer halo + SpriteText label
  const createNodeObject = useCallback((node: ArchitectureNode) => {
    const group = new THREE.Group();
    const radius = Math.max(3.2, Math.sqrt(node.size || 16) * 1.6);
    const nodeColor = new THREE.Color(node.color);

    // 1. Central glowing star sphere
    const sphereGeo = new THREE.SphereGeometry(radius, 24, 24);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: nodeColor,
      emissive: nodeColor,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.4
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    group.add(sphere);

    // 2. Outer translucent nebula / glow aura
    const auraGeo = new THREE.SphereGeometry(radius * 1.5, 16, 16);
    const auraMat = new THREE.MeshBasicMaterial({
      color: nodeColor,
      transparent: true,
      opacity: 0.18,
      wireframe: false,
      blending: THREE.AdditiveBlending
    });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    group.add(aura);

    // 3. SpriteText Label
    const sprite = new SpriteText(node.label);
    sprite.color = '#e2e8f0';
    sprite.textHeight = Math.max(3.0, radius * 0.7);
    sprite.fontFace = 'JetBrains Mono, Courier New, monospace';
    sprite.fontWeight = '600';
    sprite.backgroundColor = 'rgba(5, 6, 10, 0.7)';
    sprite.borderColor = node.color;
    sprite.borderWidth = 0.5;
    sprite.borderRadius = 2;
    sprite.padding = 1.5;
    sprite.position.set(0, -radius - 4, 0);
    group.add(sprite);

    return group;
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#05060a]">
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#05060a"
        showNavInfo={false}
        enableNodeDrag={true}
        enableNavigationControls={true}
        nodeThreeObject={createNodeObject as any}
        nodeThreeObjectExtend={false}
        onNodeClick={(node: any) => {
          if (onNodeClick) onNodeClick(node);
          // Fly camera to focused node
          if (fgRef.current && node.x !== undefined) {
            const distance = 80;
            const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
            fgRef.current.cameraPosition(
              { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
              { x: node.x, y: node.y, z: node.z },
              1200
            );
          }
        }}
        onNodeHover={(node: any) => {
          if (onNodeHover) onNodeHover(node || null);
        }}
        // Link styling and particles
        linkColor={() => 'rgba(124, 108, 255, 0.22)'}
        linkWidth={1.2}
        linkDirectionalParticles={(l: any) => l.particleDensity || 2}
        linkDirectionalParticleSpeed={(l: any) => l.speed || 0.012}
        linkDirectionalParticleWidth={2.4}
        linkDirectionalParticleColor={(l: any) => '#38bdf8'}
        linkDirectionalArrowLength={3.2}
        linkDirectionalArrowRelPos={0.95}
        linkDirectionalArrowColor={() => 'rgba(255, 255, 255, 0.4)'}
        // Force simulation parameters for clustered galaxy look
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.25}
        warmupTicks={60}
        cooldownTicks={120}
      />
    </div>
  );
}
