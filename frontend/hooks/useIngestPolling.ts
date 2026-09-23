import { useState, useRef, useEffect, useCallback } from 'react';
import { triggerIngest, getIngestStatus } from '../lib/api';

interface UseIngestPollingOptions {
  onComplete?: () => void;
  onError?: (message: string) => void;
  maxAttempts?: number;
  intervalMs?: number;
}

export function useIngestPolling(options: UseIngestPollingOptions = {}) {
  const {
    onComplete,
    onError,
    maxAttempts = 40, // ~2 minutes with 3s intervals
    intervalMs = 3000,
  } = options;

  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [isPolling, setIsPolling] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const attemptsRef = useRef<number>(0);

  // Stop polling helper
  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsPolling(false);
    attemptsRef.current = 0;
  }, []);

  // Cleanup on unmount to avoid orphaned intervals
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const pollJob = useCallback(
    (jobId: number) => {
      stopPolling();
      setIsPolling(true);
      setStatus('running');
      setActiveJobId(jobId);
      attemptsRef.current = 0;

      timerRef.current = setInterval(async () => {
        attemptsRef.current += 1;

        if (attemptsRef.current > maxAttempts) {
          stopPolling();
          setStatus('failed');
          onError?.('Ingestion is taking longer than expected. Please check back shortly.');
          return;
        }

        try {
          const res = await getIngestStatus(jobId);

          if (res.status === 'completed') {
            stopPolling();
            setStatus('completed');
            onComplete?.();
          } else if (res.status === 'failed') {
            stopPolling();
            setStatus('failed');
            onError?.('Ingestion pipeline failed. Please try again.');
          }
        } catch (err: unknown) {
          // If polling itself errors (network glitch), don't immediately abort unless multiple failures
          console.error('Error while polling ingestion status:', err);
        }
      }, intervalMs);
    },
    [stopPolling, maxAttempts, intervalMs, onComplete, onError]
  );

  const trigger = useCallback(async () => {
    if (isPolling) return;

    try {
      setStatus('running');
      const res = await triggerIngest();
      pollJob(res.jobId);
    } catch (err: unknown) {
      setStatus('failed');
      const msg = err instanceof Error ? err.message : 'Failed to trigger ingestion pipeline';
      onError?.(msg);
    }
  }, [isPolling, pollJob, onError]);

  return {
    status,
    isPolling,
    activeJobId,
    trigger,
  };
}
