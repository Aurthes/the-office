import React from "react";
import {createRoot} from "react-dom/client";
import {BackendUpdates,BackendUpdatesEntry} from "@/features/office/components/BackendUpdates";
import "@/app/globals.css";
createRoot(document.getElementById("root")!).render(<main className="min-h-dvh bg-[var(--background)] p-4 text-[var(--foreground)]"><h1 className="mb-4">Office backend updates · isolated component</h1><BackendUpdatesEntry/><BackendUpdates/></main>);
