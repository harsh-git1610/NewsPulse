export interface TimelineCluster {
  id: number;
  label: string;
  start: string | null;
  end: string | null;
  article_count: number;
  intensity: number;
}

export interface Article {
  id: number;
  title: string;
  source: string;
  url: string;
  published_at: string;
}

export interface ClusterDetail {
  id: number;
  label: string;
  articles: Article[];
}

export interface IngestTriggerResponse {
  jobId: number;
  alreadyRunning?: boolean;
}

export interface IngestStatusResponse {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
}
