'use client';

import React from 'react';

interface HeaderProps {
  status: 'idle' | 'running' | 'completed' | 'failed';
  isPolling: boolean;
  onRefresh: () => void;
  clusterCount: number;
  toastMessage?: { type: 'success' | 'error' | 'info'; text: string } | null;
  onDismissToast?: () => void;
}

export default function Header({
  status,
  isPolling,
  onRefresh,
  clusterCount,
  toastMessage,
  onDismissToast,
}: HeaderProps) {
  return (
    <header className="masthead">
      <div className="masthead-main">
        <div className="masthead-brand">
          <span className="masthead-mark">✦</span>
          <div>
            <h1 className="masthead-title">NewsPulse</h1>
            <p className="masthead-subtitle">Topic Cluster Timeline</p>
          </div>
          {clusterCount > 0 && (
            <span className="masthead-count">{clusterCount} clusters</span>
          )}
        </div>

        <div className="masthead-actions">
          <button
            type="button"
            className={`btn-wire ${isPolling ? 'polling' : ''}`}
            onClick={onRefresh}
            disabled={isPolling}
            title={isPolling ? 'Ingestion pipeline in progress' : 'Trigger ingestion and re-cluster'}
          >
            {isPolling ? (
              <>
                <span className="pulse-dot"></span>
                <span>Fetching wire…</span>
              </>
            ) : (
              <span>Refresh data</span>
            )}
          </button>
        </div>
      </div>

      {toastMessage && (
        <div className={`wire-banner wire-banner-${toastMessage.type}`}>
          <span className="wire-banner-text">{toastMessage.text}</span>
          {onDismissToast && (
            <button className="wire-banner-close" onClick={onDismissToast} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      )}
    </header>
  );
}
