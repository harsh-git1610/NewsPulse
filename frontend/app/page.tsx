'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TimelineCluster } from '../types';
import { getTimeline, getClusterDetail } from '../lib/api';
import { useIngestPolling } from '../hooks/useIngestPolling';
import Header from '../components/Header';
import SourceFilter from '../components/SourceFilter';
import TimelineView from '../components/TimelineView';
import ClusterModal from '../components/ClusterModal';

export default function HomePage() {
  const [clusters, setClusters] = useState<TimelineCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Mapping of clusterId -> array of source strings
  const [clusterSourcesMap, setClusterSourcesMap] = useState<Record<number, string[]>>({});
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  // Fetch timeline data from API
  const fetchTimelineData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTimeline();
      setClusters(data);
      setLoading(false);

      // Asynchronously fetch sources for each cluster to populate source filters
      if (data.length > 0) {
        // Fetch cluster details in background to identify member article sources
        Promise.allSettled(data.map((c) => getClusterDetail(c.id))).then((results) => {
          const map: Record<number, string[]> = {};
          const sourceSet = new Set<string>();

          results.forEach((res) => {
            if (res.status === 'fulfilled') {
              const clusterDetail = res.value;
              const sources = Array.from(
                new Set(clusterDetail.articles.map((a) => a.source.toLowerCase()))
              );
              map[clusterDetail.id] = sources;
              sources.forEach((s) => sourceSet.add(s));
            }
          });

          setClusterSourcesMap(map);
          const distinctSources = Array.from(sourceSet).sort();
          setAvailableSources(distinctSources);
          setSelectedSources(distinctSources);
        });
      }
    } catch (_err: unknown) {
      setError("Couldn't reach the timeline. Check that the API is running, then try again.");
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchTimelineData();
  }, [fetchTimelineData]);

  // Hook for triggering pipeline and polling status
  const { status: ingestStatus, isPolling, trigger } = useIngestPolling({
    onComplete: () => {
      setToastMessage({
        type: 'success',
        text: 'The wire has been updated with the latest dispatches.',
      });
      fetchTimelineData();
    },
    onError: () => {
      setToastMessage({
        type: 'error',
        text: 'The last refresh failed partway through. Try again, or check the job log.',
      });
    },
  });

  const handleRefreshClick = () => {
    setToastMessage({
      type: 'info',
      text: 'Pulling the wire and grouping stories…',
    });
    trigger();
  };

  // Toggle individual source
  const handleToggleSource = (source: string) => {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]
    );
  };

  const handleSelectAllSources = () => {
    setSelectedSources(availableSources);
  };

  const handleDeselectAllSources = () => {
    setSelectedSources([]);
  };

  // Filter & sorting states
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | '24h'>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'multi'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'largest' | 'chronological'>('newest');

  // Today label calculation
  const todayDateStr = useMemo(() => {
    return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  }, []);

  // Filter clusters: source matching, time window, and scope (multi-article)
  const visibleClusters = useMemo(() => {
    const now = new Date();
    const isSameCalendarDay = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();
    const past24hCutoff = Date.now() - 24 * 60 * 60 * 1000;

    let result = clusters;

    // 1. Source filter
    if (availableSources.length > 0 && selectedSources.length < availableSources.length) {
      result = result.filter((cluster) => {
        const sources = clusterSourcesMap[cluster.id];
        if (!sources || sources.length === 0) return true;
        return sources.some((s) => selectedSources.includes(s));
      });
    }

    // 2. Time window filter
    if (timeFilter === 'today') {
      result = result.filter((cluster) => {
        const clusterStart = cluster.start ? new Date(cluster.start) : null;
        const clusterEnd = cluster.end ? new Date(cluster.end) : null;
        return (
          (clusterEnd && isSameCalendarDay(clusterEnd, now)) ||
          (clusterStart && isSameCalendarDay(clusterStart, now))
        );
      });
    } else if (timeFilter === '24h') {
      result = result.filter((cluster) => {
        const clusterStart = cluster.start ? new Date(cluster.start) : null;
        const clusterEnd = cluster.end ? new Date(cluster.end) : null;
        return (
          (clusterEnd && clusterEnd.getTime() >= past24hCutoff) ||
          (clusterStart && clusterStart.getTime() >= past24hCutoff)
        );
      });
    }

    // 3. Scope filter (Developing stories with 2+ articles vs all)
    if (scopeFilter === 'multi') {
      result = result.filter((cluster) => cluster.article_count > 1);
    }

    // 4. Sort order
    return [...result].sort((a, b) => {
      if (sortBy === 'newest') {
        const timeA = new Date(a.end || a.start || 0).getTime();
        const timeB = new Date(b.end || b.start || 0).getTime();
        return timeB - timeA;
      }
      if (sortBy === 'largest') {
        return b.article_count - a.article_count;
      }
      // chronological
      const timeA = new Date(a.start || a.end || 0).getTime();
      const timeB = new Date(b.start || b.end || 0).getTime();
      return timeA - timeB;
    });
  }, [
    clusters,
    clusterSourcesMap,
    availableSources,
    selectedSources,
    timeFilter,
    scopeFilter,
    sortBy,
  ]);

  return (
    <main className="page-container">
      <Header
        status={ingestStatus}
        isPolling={isPolling}
        onRefresh={handleRefreshClick}
        clusterCount={visibleClusters.length}
        toastMessage={toastMessage}
        onDismissToast={() => setToastMessage(null)}
      />

      {error && (
        <div className="wire-banner wire-banner-error">
          <span className="wire-banner-text">{error}</span>
          <button className="btn-wire-inline" onClick={fetchTimelineData}>
            Try again
          </button>
        </div>
      )}

      {availableSources.length > 0 && (
        <SourceFilter
          availableSources={availableSources}
          selectedSources={selectedSources}
          onToggleSource={handleToggleSource}
          onSelectAll={handleSelectAllSources}
          onDeselectAll={handleDeselectAllSources}
        />
      )}

      <TimelineView
        clusters={visibleClusters}
        selectedClusterId={selectedClusterId}
        onSelectCluster={(id) => setSelectedClusterId(id)}
        loading={loading}
      />

      {/* News Storylines Feed */}
      {!loading && (
        <section className="storylines-section">
          <div className="section-header">
            <div>
              <h2 className="section-title">Trending News Storylines</h2>
              <p className="section-sub">
                Click any storyline to view all articles and compare sources
              </p>
            </div>
            <span className="section-count">{visibleClusters.length} topics</span>
          </div>

          {/* Editorial Toolbar: Time Window, Scope, Sort */}
          <div className="storylines-toolbar">
            <div className="toolbar-group">
              <span className="toolbar-label">WINDOW:</span>
              <button
                type="button"
                className={`toolbar-btn ${timeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTimeFilter('all')}
              >
                ALL DISPATCHES
              </button>
              <span className="source-separator" aria-hidden="true">|</span>
              <button
                type="button"
                className={`toolbar-btn ${timeFilter === 'today' ? 'active' : ''}`}
                onClick={() => setTimeFilter('today')}
              >
                TODAY ({todayDateStr})
              </button>
              <span className="source-separator" aria-hidden="true">|</span>
              <button
                type="button"
                className={`toolbar-btn ${timeFilter === '24h' ? 'active' : ''}`}
                onClick={() => setTimeFilter('24h')}
              >
                PAST 24H
              </button>
            </div>

            <div className="toolbar-group">
              <span className="toolbar-label">SCOPE:</span>
              <button
                type="button"
                className={`toolbar-btn ${scopeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setScopeFilter('all')}
              >
                ALL TOPICS
              </button>
              <span className="source-separator" aria-hidden="true">|</span>
              <button
                type="button"
                className={`toolbar-btn ${scopeFilter === 'multi' ? 'active' : ''}`}
                onClick={() => setScopeFilter('multi')}
              >
                DEVELOPING (2+ ARTICLES)
              </button>
            </div>

            <div className="toolbar-group">
              <span className="toolbar-label">SORT:</span>
              <button
                type="button"
                className={`toolbar-btn ${sortBy === 'newest' ? 'active' : ''}`}
                onClick={() => setSortBy('newest')}
              >
                NEWEST FIRST
              </button>
              <span className="source-separator" aria-hidden="true">|</span>
              <button
                type="button"
                className={`toolbar-btn ${sortBy === 'largest' ? 'active' : ''}`}
                onClick={() => setSortBy('largest')}
              >
                MOST COVERED
              </button>
            </div>
          </div>

          {visibleClusters.length === 0 ? (
            <div className="timeline-empty" style={{ minHeight: '160px', padding: '2rem 1rem' }}>
              <h3 className="empty-heading">No matching storylines</h3>
              <p className="empty-subline">
                No dispatches found for the selected window or filters. Try switching to &quot;ALL DISPATCHES&quot;.
              </p>
            </div>
          ) : (
            <div className="storylines-grid">
              {visibleClusters.map((cluster) => {
                const sources = clusterSourcesMap[cluster.id] || [];
                const startDate = cluster.start ? new Date(cluster.start) : null;
                const endDate = cluster.end ? new Date(cluster.end) : null;
                const startStr = startDate
                  ? startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : '';
                const endStr = endDate
                  ? endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : '';
                const dateDisplay =
                  startStr && endStr && startStr !== endStr
                    ? `${startStr} – ${endStr}`
                    : endStr || startStr;

                return (
                  <div
                    key={cluster.id}
                    className={`storyline-card ${selectedClusterId === cluster.id ? 'active' : ''}`}
                    onClick={() => setSelectedClusterId(cluster.id)}
                  >
                    <div className="storyline-meta">
                      <span className="storyline-badge">Cluster #{cluster.id}</span>
                      <span className="storyline-articles-badge">
                        {cluster.article_count} {cluster.article_count === 1 ? 'article' : 'articles'}
                      </span>
                      {dateDisplay && <span className="storyline-date">{dateDisplay}</span>}
                    </div>

                    <h3 className="storyline-label">{cluster.label}</h3>

                    <div className="storyline-footer">
                      <div className="storyline-sources">
                        {sources.map((s) => (
                          <span
                            key={s}
                            className={`source-mini-badge source-${s.toLowerCase()}`}
                          >
                            {s.toUpperCase()}
                          </span>
                        ))}
                      </div>
                      <span className="storyline-action">Read story ↗</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <ClusterModal
        clusterId={selectedClusterId}
        onClose={() => setSelectedClusterId(null)}
        selectedSources={selectedSources}
      />
    </main>
  );
}
