"use client";
import { Component, Suspense } from "react";
import { Environment } from "@react-three/drei";

// The light map improves reflections; the office's own lights remain usable
// when this optional download fails.
export class OptionalEnvironment extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? null : <Suspense fallback={null}>
      <Environment files="/environments/potsdamer_platz_1k.hdr" />
    </Suspense>;
  }
}
