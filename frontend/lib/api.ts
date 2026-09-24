import {
  TimelineCluster,
  ClusterDetail,
  IngestTriggerResponse,
  IngestStatusResponse,
} from '../types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Helper to handle fetch responses and enforce explicit error checking.
 */
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMsg = `API request failed with status ${res.status}`;
    try {
      const errData = await res.json();
      if (errData && errData.error) {
        errorMsg = errData.error;
      }
    } catch {
      // Body is not JSON, fallback to status text
      if (res.statusText) {
        errorMsg = res.statusText;
      }
    }
    throw new ApiError(res.status, errorMsg);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch timeline clusters with normalized intensity.
 */
export async function getTimeline(): Promise<TimelineCluster[]> {
  const res = await fetch(`${BASE_URL}/timeline`, {
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<TimelineCluster[]>(res);
}

/**
 * Fetch full cluster details including sorted member articles.
 */
export async function getClusterDetail(id: number): Promise<ClusterDetail> {
  const res = await fetch(`${BASE_URL}/clusters/${id}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<ClusterDetail>(res);
}

/**
 * Trigger background ingestion and clustering pipeline.
 * Handles 409 Conflict gracefully by extracting the already-running jobId.
 */
export async function triggerIngest(): Promise<IngestTriggerResponse> {
  const res = await fetch(`${BASE_URL}/ingest/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (res.status === 409) {
    const data = await res.json();
    return {
      jobId: data.jobId,
      alreadyRunning: true,
    };
  }

  const data = await handleResponse<{ jobId: number }>(res);
  return {
    jobId: data.jobId,
    alreadyRunning: false,
  };
}

/**
 * Poll ingestion job status.
 */
export async function getIngestStatus(jobId: number): Promise<IngestStatusResponse> {
  const res = await fetch(`${BASE_URL}/ingest/status/${jobId}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<IngestStatusResponse>(res);
}
