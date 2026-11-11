import type { DataSource } from './index';
import { createMockDataSource } from './mock';
import { createHttpDataSource } from './http';

const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock';
const latency = Number(import.meta.env.VITE_MOCK_LATENCY ?? 250);

/**
 * The app's single data entry point. Pages import `data` and never touch the
 * mock or HTTP implementations directly, so switching backends is one env var.
 */
export const data: DataSource =
  source === 'http' ? createHttpDataSource() : createMockDataSource({ latency });

export const dataSourceKind = source;
