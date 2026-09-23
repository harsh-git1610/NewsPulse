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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-badge">Cluster #{clusterId}</span>
            <h2 className="modal-title">
              {detail ? detail.label : `Loading Cluster #${clusterId}...`}
            </h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="modal-loading">
              <div className="spinner"></div>
              <p>Fetching articles for this cluster...</p>
            </div>
          )}

          {error && (
            <div className="modal-error">
              <p>⚠️ {error}</p>
              <button
                className="btn-retry"
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
            <div className="article-list-container">
              <div className="article-list-header">
                <span className="article-count-label">
                  Showing {displayedArticles.length} of {detail.articles.length} articles
                </span>
                <span className="article-sort-hint">Sorted chronologically (oldest to newest)</span>
              </div>

              {displayedArticles.length === 0 ? (
                <div className="modal-empty-filter">
                  <p>No articles match the currently selected source filters.</p>
                </div>
              ) : (
                <div className="article-list">
                  {displayedArticles.map((article) => {
                    const pubDate = article.published_at
                      ? new Date(article.published_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'Unknown date';

                    return (
                      <div key={article.id} className="article-card">
                        <div className="article-meta">
                          <span className={`source-badge source-${article.source.toLowerCase()}`}>
                            {article.source.toUpperCase()}
                          </span>
                          <span className="article-date">{pubDate}</span>
                        </div>
                        <h4 className="article-title">{article.title}</h4>
                        <div className="article-actions">
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="article-link"
                          >
                            Read original article ↗
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
