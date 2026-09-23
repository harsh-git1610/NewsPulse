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
    <div className="source-filter-row">
      <div className="source-filter-prefix">
        <span className="source-filter-label">WIRE SOURCES</span>
        <button
          type="button"
          className="source-toggle-all-btn"
          onClick={allSelected ? onDeselectAll : onSelectAll}
        >
          [{allSelected ? 'clear' : 'all'}]
        </button>
      </div>

      <div className="source-toggles">
        {availableSources.map((source, index) => {
          const isChecked = selectedSources.includes(source);
          return (
            <React.Fragment key={source}>
              {index > 0 && <span className="source-separator" aria-hidden="true">|</span>}
              <button
                type="button"
                className={`source-toggle-item ${isChecked ? 'active' : 'inactive'}`}
                onClick={() => onToggleSource(source)}
              >
                {source.toUpperCase()}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
