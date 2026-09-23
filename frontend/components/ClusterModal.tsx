'use client';

import React, { useEffect, useState } from 'react';
import { ClusterDetail, Article } from '../types';
import { getClusterDetail } from '../lib/api';

interface ClusterModalProps {
  clusterId: number | null;
  onClose: () => void;
  selectedSources?: string[];
}

export default function ClusterModal({
  clusterId,
  onClose,
  selectedSources,
}: ClusterModalProps) {
  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clusterId) {
      setDetail(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    getClusterDetail(clusterId)
      .then((data) => {
        if (isMounted) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : 'Failed to load cluster details';
          setError(msg);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [clusterId]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!clusterId) return null;

  // Filter articles by selected sources if provided
  const displayedArticles: Article[] =
    detail && selectedSources && selectedSources.length > 0
      ? detail.articles.filter((a) =>
          selectedSources.includes(a.source.toLowerCase())
        )
      : detail?.articles || [];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="drawer-header">
          <div>
            <span className="drawer-kicker">DISPATCH #{clusterId}</span>
            <h2 className="drawer-title">
              {detail ? detail.label : `Loading Cluster #${clusterId}…`}
            </h2>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {loading && (
            <div className="drawer-loading">
              <span className="pulse-dot"></span>
              <p>Fetching dispatch articles…</p>
            </div>
          )}

          {error && (
            <div className="wire-banner wire-banner-error">
              <p>{error}</p>
              <button
                className="btn-wire-inline"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  getClusterDetail(clusterId)
                    .then((data) => {
                      setDetail(data);
                      setLoading(false);
                    })
                    .catch((err) => {
                      setError(err.message || 'Retry failed');
                      setLoading(false);
                    });
                }}
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && detail && (
            <div className="drawer-articles">
              <div className="drawer-meta-line">
                <span>{displayedArticles.length} of {detail.articles.length} articles</span>
                <span>Chronological</span>
              </div>

              {displayedArticles.length === 0 ? (
                <div className="drawer-empty">
                  <p>No articles match the selected wire filters.</p>
                </div>
              ) : (
                <ul className="drawer-article-list">
                  {displayedArticles.map((article) => {
                    const pubDate = article.published_at
                      ? new Date(article.published_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'Unknown date';

                    return (
                      <li key={article.id} className="drawer-article-item">
                        <div className="article-byline">
                          <span className="article-source-tag">{article.source.toUpperCase()}</span>
                          <span className="article-timestamp">{pubDate}</span>
                        </div>
                        <h4 className="article-headline">{article.title}</h4>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="article-ext-link"
                        >
                          View wire source ↗
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
