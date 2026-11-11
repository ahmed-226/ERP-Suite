// Augment the request with the request id set by the requestId middleware.
// Uses the global Express namespace — the documented extension point — rather
// than augmenting the internal module name, which shadows it under bundler
// resolution and breaks the rest of the express typings.
declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
