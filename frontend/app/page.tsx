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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch timeline data';
      setError(msg);
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
        text: 'Ingestion & clustering completed successfully! Timeline updated.',
      });
      fetchTimelineData();
    },
    onError: (msg) => {
      setToastMessage({
        type: 'error',
        text: msg,
      });
    },
  });

  const handleRefreshClick = () => {
    setToastMessage({
      type: 'info',
      text: 'Triggering ingestion and topic clustering pipeline...',
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
        <div className="error-banner">
          <div>
            <strong>Unable to load timeline:</strong> {error}
          </div>
          <button className="btn-retry" onClick={fetchTimelineData}>
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

      <ClusterModal
        clusterId={selectedClusterId}
        onClose={() => setSelectedClusterId(null)}
        selectedSources={selectedSources}
      />
    </main>
  );
}
