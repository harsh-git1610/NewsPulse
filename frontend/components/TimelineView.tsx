'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TimelineCluster } from '../types';

interface TimelineViewProps {
  clusters: TimelineCluster[];
  selectedClusterId: number | null;
  onSelectCluster: (id: number) => void;
  loading: boolean;
  priorityLabel?: string; // optional caption shown above chart
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function TimelineView({
  clusters,
  selectedClusterId,
  onSelectCluster,
  loading,
  priorityLabel,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<any>(null);
  const dataSetRef = useRef<any>(null);
  const initialWindowSetRef = useRef<boolean>(false);

  // Stable callback ref so onSelectCluster changing never re-initializes the Timeline
  const onSelectRef = useRef(onSelectCluster);
  useEffect(() => {
    onSelectRef.current = onSelectCluster;
  });

  const [isTimelineReady, setIsTimelineReady] = useState(false);

  // ── EFFECT 1: Initialize vis-timeline exactly ONCE on mount ────────────────
  useEffect(() => {
    let isMounted = true;

    async function initTimeline() {
      if (!containerRef.current) return;

      try {
        const { Timeline } = await import('vis-timeline/standalone');
        const { DataSet } = await import('vis-data');

        if (!isMounted || !containerRef.current) return;

        const dataSet = new DataSet([]);
        dataSetRef.current = dataSet;

        // Derive start, end, min, and max Date bounds
        // Default to 12h window so the chart isn't overcrowded on first load
        const now = Date.now();
        const defaultEnd = new Date(now + 1 * 60 * 60 * 1000);   // 1h padding ahead
        const defaultStart = new Date(defaultEnd.getTime() - 12 * 60 * 60 * 1000); // 12h window
        const minBound = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const maxBound = new Date(now + 24 * 60 * 60 * 1000);

        console.log('[TimelineView] Initializing Timeline with options:', {
          start: defaultStart.toISOString(),
          end: defaultEnd.toISOString(),
          min: minBound.toISOString(),
          max: maxBound.toISOString(),
        });

        const options: any = {
          height: '560px', // tall enough for ~8 stacked rows; NO maxHeight — required for verticalScroll
          zoomable: true,
          moveable: true,
          verticalScroll: true,
          stack: true,
          showCurrentTime: true,
          start: defaultStart,
          end: defaultEnd,
          min: minBound,
          max: maxBound,
          orientation: {
            axis: 'bottom',
            item: 'bottom',
          },
          zoomMin: 1000 * 60 * 60,           // 1 hour minimum zoom
          zoomMax: 1000 * 60 * 60 * 24 * 14, // 2 weeks maximum zoom
          tooltip: {
            followMouse: true,   // tooltip follows cursor so it doesn't obscure the item
            overflowMethod: 'flip', // flip to stay in viewport
            delay: 200,          // ms before tooltip appears
          },
          format: {
            minorLabels: (date: any, scale: string) => {
              const d = new Date(date);
              // Filter out non-dates or fallback origin ticks (e.g. 1970 timestamp 0)
              if (isNaN(d.getTime()) || d.getFullYear() < 2020) return '';
              if (scale === 'millisecond') return d.getMilliseconds().toString();
              if (scale === 'second') return `${String(d.getSeconds()).padStart(2, '0')}s`;
              if (scale === 'minute' || scale === 'hour') {
                const h = String(d.getHours()).padStart(2, '0');
                const m = String(d.getMinutes()).padStart(2, '0');
                return `${h}:${m}`;
              }
              if (scale === 'weekday' || scale === 'day') {
                return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              }
              if (scale === 'month') {
                return d.toLocaleDateString('en-GB', { month: 'short' });
              }
              return d.getFullYear().toString();
            },
            majorLabels: (date: any, scale: string) => {
              const d = new Date(date);
              if (isNaN(d.getTime()) || d.getFullYear() < 2020) return '';
              if (scale === 'millisecond' || scale === 'second' || scale === 'minute' || scale === 'hour') {
                return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
              }
              if (scale === 'weekday' || scale === 'day' || scale === 'week') {
                return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
              }
              return d.getFullYear().toString();
            },
          },
          selectable: true,
          multiselect: false,
          margin: {
            item: {
              vertical: 8,  // Clear spacing between stacked rows to eliminate bleeding
              horizontal: 4,
            },
            axis: 8,
          },
        };

        const timeline = new Timeline(containerRef.current, dataSet, options);
        timelineRef.current = timeline;

        timeline.on('select', (properties: { items: (string | number)[] }) => {
          if (properties.items && properties.items.length > 0) {
            const clusterId = Number(properties.items[0]);
            if (!isNaN(clusterId)) {
              onSelectRef.current(clusterId);
            }
          }
        });

        // ── Scrub stray "0" axis tick ──────────────────────────────────────────
        // vis-timeline occasionally renders a label at pixel-x=0 whose text content
        // is an empty string or the raw string "0" (not a formatted time label).
        // We use a MutationObserver to remove these after every DOM paint.
        function scrubZeroTick(root: HTMLElement) {
          root.querySelectorAll('.vis-time-axis .vis-text').forEach((el) => {
            const text = (el as HTMLElement).innerText?.trim();
            if (text === '0' || text === '') {
              (el as HTMLElement).style.visibility = 'hidden';
            }
          });
        }

        if (containerRef.current) {
          const observer = new MutationObserver(() => {
            if (containerRef.current) scrubZeroTick(containerRef.current);
          });
          observer.observe(containerRef.current, { childList: true, subtree: true });
          // Store observer on the timeline ref for cleanup
          (timelineRef.current as any)._zeroTickObserver = observer;
          // Run once immediately after init
          scrubZeroTick(containerRef.current);
        }

        // Re-scrub on every zoom/pan so newly rendered ticks are also cleaned
        timeline.on('rangechanged', () => {
          if (containerRef.current) scrubZeroTick(containerRef.current);
        });

        setIsTimelineReady(true);
      } catch (err) {
        console.error('[TimelineView] Failed to initialize vis-timeline:', err);
      }
    }

    initTimeline();

    return () => {
      isMounted = false;
      if (timelineRef.current) {
        // Disconnect the MutationObserver if it was attached
        if ((timelineRef.current as any)._zeroTickObserver) {
          (timelineRef.current as any)._zeroTickObserver.disconnect();
        }
        timelineRef.current.destroy();
        timelineRef.current = null;
        dataSetRef.current = null;
      }
    };
  }, []);

  // ── EFFECT 2: Reactive DataSet updates when cluster data arrives ─────────
  useEffect(() => {
    if (!isTimelineReady || !dataSetRef.current) return;

    const items = clusters.map((cluster) => {
      const startTime = cluster.start ? new Date(cluster.start) : new Date();
      let endTime = cluster.end ? new Date(cluster.end) : startTime;

      // Minimum 1-hour visual span so single-article or zero-duration clusters remain visible
      if (endTime.getTime() - startTime.getTime() < 60 * 60 * 1000) {
        endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      }

      const isSelected = selectedClusterId === cluster.id;

      const content = `
        <div class="editorial-block-content">
          <span class="editorial-block-title">${escapeHtml(cluster.label)}</span>
          <span class="editorial-block-pill">${cluster.article_count}</span>
        </div>
      `;

      return {
        id: cluster.id,
        content,
        title: cluster.label, // Full headline in native hover tooltip
        start: startTime,
        end: endTime,
        type: 'range',
        className: `editorial-timeline-item ${isSelected ? 'selected' : ''}`,
      };
    });

    try {
      dataSetRef.current.clear();
      dataSetRef.current.add(items);

      // Adjust min/max bounds based on actual cluster data range
      if (items.length > 0 && timelineRef.current) {
        const timestamps = items.map((i) => i.start.getTime());
        const earliest = Math.min(...timestamps);
        const dataMin = new Date(Math.min(earliest - 24 * 60 * 60 * 1000, Date.now() - 7 * 24 * 60 * 60 * 1000));
        timelineRef.current.setOptions({
          min: dataMin,
          max: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        // Set initial window once on mount without resetting user's subsequent pan/zoom
        // Use 12h window so items aren't too compressed on first render
        if (!initialWindowSetRef.current) {
          const windowEnd = new Date(Date.now() + 1 * 60 * 60 * 1000);
          const windowStart = new Date(windowEnd.getTime() - 12 * 60 * 60 * 1000);
          timelineRef.current.setWindow(windowStart, windowEnd, {
            animation: { duration: 400, easingFunction: 'easeInOutQuad' },
          });
          initialWindowSetRef.current = true;
        }
      }
    } catch (e) {
      console.error('[TimelineView] Failed to update DataSet:', e);
    }
  }, [clusters, isTimelineReady, selectedClusterId]);

  // Sync selection without resetting window / zoom
  useEffect(() => {
    if (!timelineRef.current || !isTimelineReady) return;
    try {
      if (selectedClusterId !== null) {
        timelineRef.current.setSelection([selectedClusterId]);
      } else {
        timelineRef.current.setSelection([]);
      }
    } catch (e) {
      // Safe to ignore selection sync errors
    }
  }, [selectedClusterId, isTimelineReady]);

  return (
    <div className="timeline-wrapper">
      {/* Priority label + baseline ruler */}
      {!loading && priorityLabel && clusters.length > 0 && (
        <div className="timeline-priority-label">{priorityLabel}</div>
      )}
      <div className="timeline-baseline" aria-hidden="true" />

      {loading && (
        <div className="timeline-skeleton">
          <div className="skeleton-line" />
          <div className="skeleton-grid">
            <div className="skeleton-card" style={{ width: '40%' }} />
            <div className="skeleton-card" style={{ width: '60%' }} />
            <div className="skeleton-card" style={{ width: '30%' }} />
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

