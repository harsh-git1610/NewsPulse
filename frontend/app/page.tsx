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

  // Filter clusters: A cluster remains visible if ANY of its member sources match the selected sources.
  // If cluster sources are not yet resolved, keep cluster visible by default.
  const visibleClusters = useMemo(() => {
    if (availableSources.length === 0 || selectedSources.length === availableSources.length) {
      return clusters;
    }

    return clusters.filter((cluster) => {
      const sources = clusterSourcesMap[cluster.id];
      if (!sources || sources.length === 0) {
        return true; // Keep visible while loading
      }
      return sources.some((s) => selectedSources.includes(s));
    });
  }, [clusters, clusterSourcesMap, availableSources, selectedSources]);

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
      {!loading && visibleClusters.length > 0 && (
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

          <div className="storylines-grid">
            {visibleClusters.map((cluster) => {
              const sources = clusterSourcesMap[cluster.id] || [];
              const dateStr = cluster.start
                ? new Date(cluster.start).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })
                : '';

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
                    {dateStr && <span className="storyline-date">{dateStr}</span>}
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
