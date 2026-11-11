/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which DataSource implementation to use. Defaults to `mock`. */
  readonly VITE_DATA_SOURCE?: 'mock' | 'http';
  /** Simulated latency (ms) for the mock data source. Defaults to 250. */
  readonly VITE_MOCK_LATENCY?: string;
  /** Base URL of the API when VITE_DATA_SOURCE=http. Defaults to `/api/v1`. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
