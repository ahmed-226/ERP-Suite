/** Error shape shared by the mock store and (Stage C) the HTTP client. */
export class DataError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.status = status;
  }
}

export function isDataError(error: unknown): error is DataError {
  return error instanceof DataError;
}
