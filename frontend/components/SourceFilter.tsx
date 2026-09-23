'use client';

import React from 'react';

interface SourceFilterProps {
  availableSources: string[];
  selectedSources: string[];
  onToggleSource: (source: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export default function SourceFilter({
  availableSources,
  selectedSources,
  onToggleSource,
  onSelectAll,
  onDeselectAll,
}: SourceFilterProps) {
  if (availableSources.length === 0) {
    return null;
  }

  const allSelected = availableSources.every((s) => selectedSources.includes(s));

  return (
    <div className="filter-bar">
      <div className="filter-header">
        <span className="filter-title">Sources</span>
        <div className="filter-actions">
          <button
            type="button"
            className="filter-text-btn"
            onClick={allSelected ? onDeselectAll : onSelectAll}
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        </div>
      </div>

      <div className="filter-chips">
        {availableSources.map((source) => {
          const isChecked = selectedSources.includes(source);
          return (
            <label
              key={source}
              className={`filter-chip ${isChecked ? 'active' : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleSource(source)}
                className="chip-checkbox"
              />
              <span className={`chip-dot source-dot-${source}`}></span>
              <span className="chip-label">{source.toUpperCase()}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
