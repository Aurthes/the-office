"use client";

import { Component, type ReactNode } from "react";

/** Keep chat and office controls available when a device cannot render 3D. */
export class OfficeSceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex h-full items-center justify-center text-center">
          <div>
            <p>The 3D office could not load. You can continue in chat.</p>
            {/* Full navigation also works when the 3D page cannot recover. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="mt-3 inline-block underline" href="/agents">Open chat</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
