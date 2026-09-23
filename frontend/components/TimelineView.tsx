'use client';

import React, { useEffect, useRef, useState } from 'react';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';
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
          height: '440px',
          minHeight: '380px',
          stack: true,
          showCurrentTime: true,
          orientation: {
            axis: 'bottom',
            item: 'bottom',
          },
          zoomMin: 1000 * 60 * 15,
          zoomMax: 1000 * 60 * 60 * 24 * 30,
          horizontalScroll: true,
          selectable: true,
          multiselect: false,
          margin: {
            item: {
              horizontal: 8,
              vertical: 6,
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

    return () => {
      isMounted = false;
      if (timelineRef.current) {
        timelineRef.current.destroy();
        timelineRef.current = null;
      }
    };
  }, [onSelectCluster]);

  useEffect(() => {
    if (!isTimelineReady) return;

    const items = clusters.map((cluster) => {
      const startTime = cluster.start ? new Date(cluster.start) : new Date();
      let endTime = cluster.end ? new Date(cluster.end) : startTime;

      if (endTime.getTime() - startTime.getTime() < 3 * 60 * 60 * 1000) {
        endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);
      }

      const isSelected = selectedClusterId === cluster.id;
      // Height scaled by intensity between 24px and 120px
      const blockHeight = Math.round(24 + (cluster.intensity || 0) * 96);

      const titleTooltip = `
        <div style="font-family: var(--font-public-sans), sans-serif; font-size: 12px; line-height: 1.4; padding: 4px;">
          <strong style="font-family: var(--font-fraunces), serif;">${cluster.label}</strong><br/>
          Articles: ${cluster.article_count}<br/>
          Intensity: ${Math.round(cluster.intensity * 100)}%<br/>
          Span: ${startTime.toLocaleDateString()} ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleDateString()} ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      `;

      const content = `
        <div class="editorial-block-content" style="height: ${blockHeight - 6}px;">
          <span class="editorial-block-title">${cluster.label}</span>
          <span class="editorial-block-pill">${cluster.article_count}</span>
        </div>
      `;

      return {
        id: cluster.id,
        content,
        start: startTime,
        end: endTime,
        type: 'range',
        className: `editorial-timeline-item ${isSelected ? 'selected' : ''}`,
        style: `height: ${blockHeight}px;`,
        title: titleTooltip,
      };
    });

    if (timelineRef.current) {
      try {
        timelineRef.current.setItems(items);
        if (items.length > 0) {
          timelineRef.current.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
        }
      } catch (e) {
        console.error('Failed to set timeline items:', e);
      }
    }
  }, [clusters, isTimelineReady, selectedClusterId]);

  return (
    <div className="timeline-wrapper">
      {/* Baseline ruler */}
      <div className="timeline-baseline" aria-hidden="true"></div>

      {loading && (
        <div className="timeline-skeleton">
          <div className="skeleton-line"></div>
          <div className="skeleton-grid">
            <div className="skeleton-card" style={{ width: '40%' }}></div>
            <div className="skeleton-card" style={{ width: '60%' }}></div>
            <div className="skeleton-card" style={{ width: '30%' }}></div>
          </div>
          <p className="skeleton-text">Interpreting wire timeline…</p>
        </div>
      )}

      {!loading && clusters.length === 0 && (
        <div className="timeline-empty">
          <h3 className="empty-heading">No dispatches yet.</h3>
          <p className="empty-subline">
            Trigger a refresh to pull the latest wire and group it into stories.
          </p>
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
