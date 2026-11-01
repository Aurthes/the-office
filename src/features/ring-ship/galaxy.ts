export const STAR_SYSTEMS = [
  { id: "deep-space", name: "Quiet Anchorage", description: "Open space, distant stars, and room to think.", color: "#acc7dc", cloud: "#234661", glow: "#82b9e4", seed: 0, position: [-2, .35, .8] },
  { id: "blue-nebula", name: "Frost Veil", description: "Cold blue filaments around a pale, ice-bound world.", color: "#6fbded", cloud: "#184e87", glow: "#83d5f2", seed: 1, position: [-1.25, 1.05, -1.55] },
  { id: "amber-nebula", name: "Ember Reach", description: "Golden dust banks and the warm rim of a desert planet.", color: "#e1b36b", cloud: "#885123", glow: "#f4d9a0", seed: 2, position: [1.1, .3, -1.5] },
  { id: "jade-nebula", name: "Viridian Sea", description: "An emerald cloud sea beyond a quiet ocean world.", color: "#73c9ad", cloud: "#205f50", glow: "#b6e0b6", seed: 3, position: [2.05, .75, .65] },
  { id: "violet-rift", name: "Violet Rift", description: "A dark fracture edged with violet light and a distant eclipse.", color: "#b397ee", cloud: "#472d78", glow: "#c6b1f0", seed: 4, position: [.1, 1.6, 1.2] },
  { id: "black-hole", name: "Event Horizon", description: "A colossal black hole looms nearby, its fiery accretion disk flowing against a field of distant stars.", color: "#f1a16c", cloud: "#151d35", glow: "#50618d", seed: 5, position: [1.55, 1.55, -.45] },
] as const;

export type StarSystem = typeof STAR_SYSTEMS[number];
export type StarSystemId = StarSystem["id"];
export const starSystem = (id: string | null): StarSystem => STAR_SYSTEMS.find(system => system.id === id) ?? STAR_SYSTEMS[0];

export type NavigationState = { current: StarSystemId; destination: StarSystemId | null; phase: "idle" | "chart" | "confirm" | "warp"; arrived: boolean };
export type NavigationAction = { type: "open" | "close" | "cancel" | "engage" | "arrive" | "complete" } | { type: "select"; id: StarSystemId };

export function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  if (action.type === "open" && state.phase === "idle") return { ...state, phase: "chart", destination: null };
  if (action.type === "close" && (state.phase === "chart" || state.phase === "confirm")) return { ...state, phase: "idle", destination: null };
  if (action.type === "select" && state.phase === "chart") {
    if (action.id === state.current || !STAR_SYSTEMS.some(system => system.id === action.id)) return state;
    return { ...state, phase: "confirm", destination: action.id };
  }
  if (action.type === "cancel" && state.phase === "confirm") return { ...state, phase: "chart", destination: null };
  if (action.type === "engage" && state.phase === "confirm" && state.destination) return { ...state, phase: "warp", arrived: false };
  if (action.type === "arrive" && state.phase === "warp" && state.destination && !state.arrived) return { ...state, current: state.destination, arrived: true };
  if (action.type === "complete" && state.phase === "warp" && state.arrived) return { ...state, phase: "idle", destination: null };
  return state;
}
