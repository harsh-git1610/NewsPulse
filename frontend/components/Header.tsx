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
    <header className="app-header">
      <div className="header-container">
        <div className="brand-group">
          <div className="brand-logo">🌐</div>
          <div>
            <h1 className="brand-title">NewsPulse</h1>
            <p className="brand-subtitle">Topic Cluster Timeline</p>
          </div>
          {clusterCount > 0 && (
            <span className="stats-pill">{clusterCount} clusters</span>
          )}
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={`btn-refresh ${isPolling ? 'loading' : ''}`}
            onClick={onRefresh}
            disabled={isPolling}
            title={isPolling ? 'Ingestion pipeline is running...' : 'Run scraper and re-cluster'}
          >
            {isPolling ? (
              <>
                <span className="btn-spinner"></span>
                <span>Updating news...</span>
              </>
            ) : (
              <>
                <span className="btn-icon">⚡</span>
                <span>Refresh data</span>
              </>
            )}
          </button>
        </div>
      </div>

      {toastMessage && (
        <div className={`toast-banner toast-${toastMessage.type}`}>
          <span className="toast-icon">
            {toastMessage.type === 'success' && '✓'}
            {toastMessage.type === 'error' && '✕'}
            {toastMessage.type === 'info' && 'ℹ'}
          </span>
          <span className="toast-text">{toastMessage.text}</span>
          {onDismissToast && (
            <button className="toast-close" onClick={onDismissToast} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      )}
    </header>
  );
}
