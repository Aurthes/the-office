"use client";
import { createContext } from "react";

// Task references open the same task board as roster and department links.
export const SessionTaskContext = createContext<((id: string) => void) | null>(null);
