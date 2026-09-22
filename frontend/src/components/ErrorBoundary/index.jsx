import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an unhandled render error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#0B0F19] text-white p-6 select-none">
          <div className="max-w-md w-full bg-[#111827] border border-slate-700/60 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
              <span className="text-red-400 text-xl font-bold">!</span>
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">
              Application Notice
            </h2>
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              A temporary render error occurred in this view. The session has been safely isolated.
            </p>
            {this.state.error && (
              <div className="w-full text-left bg-black/50 p-3 rounded-lg border border-red-500/20 mb-4 overflow-x-auto text-[11px] font-mono text-red-300 max-h-40 select-text">
                <p className="font-bold text-red-400 break-words">{this.state.error?.toString()}</p>
                <p className="text-slate-500 mt-1 whitespace-pre-wrap break-all text-[10px]">
                  {this.state.error?.stack?.split("\n").slice(1, 4).join("\n")}
                </p>
              </div>
            )}
            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex-1 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-2 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/20 transition-all"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
