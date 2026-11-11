import type { DataSource } from '../index';

/**
 * The HTTP data source is implemented in Stage C, once the API exists.
 * Until then, selecting `VITE_DATA_SOURCE=http` fails fast with a clear message.
 */
export function createHttpDataSource(): DataSource {
  throw new Error(
    'The HTTP data source is not implemented yet (Stage C). Use VITE_DATA_SOURCE=mock.',
  );
}
