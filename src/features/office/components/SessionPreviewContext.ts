"use client";
import { createContext } from "react";
import type { SessionAsset } from "./SessionControls";

export const SessionPreviewContext = createContext<((asset: SessionAsset) => void) | null>(null);
