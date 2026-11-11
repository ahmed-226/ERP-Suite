import { Component, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface ErrorBoundaryState {
  error: Error | null;
}

/** Last-resort boundary: renders an error screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="Something went wrong"
          subTitle={this.state.error.message}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
