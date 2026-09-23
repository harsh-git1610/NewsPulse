'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TimelineCluster } from '../types';

interface TimelineViewProps {
  clusters: TimelineCluster[];
  selectedClusterId: number | null;
  onSelectCluster: (id: number) => void;
  loading: boolean;
}

export default function TimelineView({
  clusters,
  selectedClusterId,
  onSelectCluster,
  loading,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<any>(null);
  const dataSetRef = useRef<any>(null);
  const [isTimelineReady, setIsTimelineReady] = useState(false);

  // Initialize Timeline exactly once
  useEffect(() => {
    let isMounted = true;

    async function initTimeline() {
      if (!containerRef.current) return;

      try {
        // Dynamically import vis-timeline/standalone and vis-data to guard against SSR
        const { Timeline } = await import('vis-timeline/standalone');
        const { DataSet } = await import('vis-data');

        if (!isMounted || !containerRef.current) return;

        const dataSet = new DataSet([]);
        dataSetRef.current = dataSet;

        const options = {
          height: '420px',
          minHeight: '350px',
          stack: true,
          showCurrentTime: true,
          zoomMin: 1000 * 60 * 15, // 15 minutes minimum zoom
          zoomMax: 1000 * 60 * 60 * 24 * 30, // 30 days maximum zoom
          horizontalScroll: true,
          selectable: true,
          multiselect: false,
          tooltip: {
            followMouse: true,
            overflowMethod: 'cap',
          },
          margin: {
            item: {
              horizontal: 10,
              vertical: 8,
            },
          },
        };

        const timeline = new Timeline(containerRef.current, dataSet, options);
        timelineRef.current = timeline;

        timeline.on('select', (properties: { items: (string | number)[] }) => {
          if (properties.items && properties.items.length > 0) {
            const clusterId = Number(properties.items[0]);
            if (!isNaN(clusterId)) {
              onSelectCluster(clusterId);
            }
          }
        });

        setIsTimelineReady(true);
      } catch (err) {
        console.error('Failed to initialize vis-timeline:', err);
      }
    }

    initTimeline();

    // Clean up timeline instance on unmount to prevent leaked DOM listeners
    return () => {
      isMounted = false;
      if (timelineRef.current) {
        timelineRef.current.destroy();
        timelineRef.current = null;
      }
    };
  }, [onSelectCluster]);

  // Update DataSet when cluster data changes (without destroying Timeline)
  useEffect(() => {
    if (!dataSetRef.current || !isTimelineReady) return;

    const items = clusters.map((cluster) => {
      const startTime = cluster.start ? new Date(cluster.start) : new Date();
      let endTime = cluster.end ? new Date(cluster.end) : startTime;

      // For single-article clusters (start === end), pad end by +30 min for visual width
      if (startTime.getTime() === endTime.getTime()) {
        endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
      }

      // Visual styling scaled by intensity (0.0 - 1.0)
      const intensityPct = Math.round(cluster.intensity * 100);
      const isSelected = selectedClusterId === cluster.id;

      // Generate dynamic color and border based on intensity and selection
      const bgOpacity = 0.2 + cluster.intensity * 0.6; // 0.2 to 0.8
      const borderWidth = 1 + Math.round(cluster.intensity * 3); // 1px to 4px

      const style = `
        background-color: rgba(59, 130, 246, ${bgOpacity});
        border: ${borderWidth}px solid ${isSelected ? '#38bdf8' : '#60a5fa'};
        border-radius: 6px;
        color: #f8fafc;
        box-shadow: ${isSelected ? '0 0 12px rgba(56, 189, 248, 0.8)' : `0 2px 6px rgba(0,0,0,0.3)`};
      `;

      const titleTooltip = `
        <div style="font-family: sans-serif; font-size: 13px; line-height: 1.4; padding: 4px;">
          <strong>${cluster.label}</strong><br/>
          Articles: ${cluster.article_count}<br/>
          Intensity: ${intensityPct}%<br/>
          Start: ${startTime.toLocaleString()}<br/>
          End: ${endTime.toLocaleString()}
        </div>
      `;

      const content = `
        <div class="cluster-item-content">
          <span class="cluster-label">${cluster.label}</span>
          <span class="cluster-badge">${cluster.article_count}</span>
        </div>
      `;

      return {
        id: cluster.id,
        content,
        start: startTime,
        end: endTime,
        type: 'range',
        style,
        title: titleTooltip,
      };
    });

    dataSetRef.current.clear();
    dataSetRef.current.add(items);

    if (items.length > 0 && timelineRef.current) {
      timelineRef.current.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    }
  }, [clusters, isTimelineReady, selectedClusterId]);

  return (
    <div className="timeline-wrapper">
      {loading && (
        <div className="timeline-skeleton">
          <div className="skeleton-line"></div>
          <div className="skeleton-grid">
            <div className="skeleton-card" style={{ width: '40%' }}></div>
            <div className="skeleton-card" style={{ width: '60%' }}></div>
            <div className="skeleton-card" style={{ width: '30%' }}></div>
          </div>
          <p className="skeleton-text">Loading cluster timeline...</p>
        </div>
      )}

      {!loading && clusters.length === 0 && (
        <div className="timeline-empty">
          <div className="empty-icon">📊</div>
          <h3>No clusters yet</h3>
          <p>Click &quot;Refresh data&quot; above to trigger the news scraper and topic clustering pipeline.</p>
        </div>
      )}

      <div
        ref={containerRef}
        className="vis-container"
        style={{ display: loading || clusters.length === 0 ? 'none' : 'block' }}
      />
    </div>
  );
}
