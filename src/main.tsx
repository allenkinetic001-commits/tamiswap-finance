import './polyfills';
import { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected display error in wallet browser.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TamiSwap render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#01030b] px-6 text-center text-slate-100">
          <div className="max-w-sm rounded-xl border border-sky-500/40 bg-[#051024] p-6 shadow-xl">
            <h1 className="text-base font-bold text-cyan-200 uppercase">
              TamiSwap Reload Required
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              Your wallet browser hit a temporary loading snag ({this.state.message}).
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 w-full rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-bold text-white uppercase"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
