export type TeaserStatus = "open" | "in_progress" | "finished";
export type TeaserWhiteboard = { id: string; text: string; revision: number; updatedAt: string | null };
export type Teaser = {
  id: string;
  revision: number;
  title: string;
  prompt: string;
  author: string;
  status: TeaserStatus;
  answer: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export const TEASER_STATUS_LABELS: Record<TeaserStatus, string> = {
  open: "Open", in_progress: "In progress", finished: "Finished",
};
