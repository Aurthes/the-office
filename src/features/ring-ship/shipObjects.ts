import * as THREE from "three";
import { DECK_STEP, type DeckIndex } from "./layout";

export const SHIP_OBJECT_INFO = {
  asteroid: ["Drifting asteroid", "A weathered traveller carrying stories older than the ship."],
  passingShip: ["Passing ship", "A fellow explorer following a distant trade route. Safe travels!"],
  passingFleet: ["Passing fleet", "A small convoy crossing our course. The crew waves from the observation deck."],
  desk: ["Desk", "A small launchpad for big ideas."],
  chairDesk: ["Desk chair", "Mission control, with a comfortable seat."],
  pottedPlant: ["Potted plant", "The quietest member of the crew."],
  plantSmall1: ["Little plant", "Small leaves, big ambitions."],
  loungeSofa: ["Lounge sofa", "For thinking very hard with your feet up."],
  tableRound: ["Dining table", "Good ideas tend to arrive around lunchtime."],
  kitchenCoffeeMachine: ["Coffee machine", "The ship's unofficial second engine."],
  kitchenCabinet: ["Kitchen cabinet", "A strategic reserve of snacks and mugs."],
  bookcaseClosed: ["Bookcase", "An offline backup of interesting thoughts."],
  lampRoundFloor: ["Floor lamp", "A little sunshine, even between stars."],
  kitchenFridgeSmall: ["Mini fridge", "Keeping refreshments cooler than deep space."],
  chairModernCushion: ["Cushioned chair", "Approved for briefings and long stories."],
  tableCoffee: ["Coffee table", "Please land your mug gently."],
  table: ["Table", "A meeting place for mugs, maps and mysteries."],
  loungeDesignChair: ["Lounge chair", "A front-row seat to absolutely nothing urgent."],
  rainforestTree: ["Rainforest tree", "A tiny piece of Earth, growing among the stars."],
  rainforestFern: ["Fern", "Unfurling one little adventure at a time."],
  rainforestBush: ["Rainforest shrub", "A green hiding place for imaginary space frogs."],
  rainforestRock: ["Garden stone", "The crew member with the longest geological résumé."],
  machineConsole: ["Machine terminal", "A little window into the engine room."],
  machineFan: ["Cooling fan", "Working hard to keep its cool."],
  workstation: ["Work desk", "Where a blank page becomes a mission."],
  locker: ["Storage locker", "Every explorer needs somewhere to put their stuff."],
  terminal: ["Service terminal", "Standing by for the next bright idea."],
  flowers: ["Flowers", "A completely unnecessary and very welcome splash of colour."],
  serviceLight: ["Cabin light", "Making late-night wandering a little less mysterious."],
  waterTank: ["Water tank", "A little rainy day, saved for later."],
  growingBed: ["Growing bed", "Farm-to-table takes a shorter route in space."],
  seedling: ["Seedling", "Currently working on becoming a salad."],
  treadmill: ["Treadmill", "Travel a thousand miles without leaving the ship."],
  exerciseMat: ["Exercise mat", "For stretching after a long journey through code."],
  weights: ["Free weights", "Gravity's smallest practical joke."],
  crate: ["Cargo crate", "Contents: probably useful. Definitely well packed."],
  bed: ["Crew bunk", "Dreams travel faster than light."],
  telescope: ["Telescope", "For checking what the neighbours are up to."],
  workbench: ["Workbench", "The birthplace of surprisingly good fixes."],
  toolbox: ["Toolbox", "Somewhere in here is exactly the right tool."],
  tools: ["Spare tools", "Ready for a little hands-on problem solving."],
  tropicalPlant: ["Tropical plant", "Taking the scenic route toward the sunlight."],
  vine: ["Hanging vine", "A slow-motion acrobat."],
  pond: ["Garden pond", "The smallest ocean on board."],
  bench: ["Garden bench", "A good place to pause the countdown."],
  serverRack: ["Server rack", "A tall stack of very busy little thoughts."],
  cables: ["Cable bundle", "The ship's surprisingly tidy nervous system."],
  monitor: ["Display", "A bright little window onto a bigger mission."],
  controlDesk: ["Command desk", "Big decisions, conveniently at elbow height."],
  dish: ["Little dish", "Awaiting its next very important snack."],
} as const;
export type ShipObjectKind = keyof typeof SHIP_OBJECT_INFO;
export type ShipObject = {
  id: string; kind: ShipObjectKind; cabinId: string; cabinName: string; deck: DeckIndex;
  bounds: THREE.Box3;
  parts: Array<{ mesh: THREE.Mesh; start: number; count: number }>;
  space?: { kind: "asteroid" | "ship"; index: number; generation: number; seed: number };
};
export type ShipObjectRange = { object: ShipObject; start: number; count: number };

// The original material batches stay intact. Ray hits identify the exact prop
// through its triangle range, including gaps occupied by floors and walls.
export function shipObjectAtHit(mesh: THREE.Object3D, faceIndex: number | null | undefined): ShipObject | null {
  if (faceIndex == null) return null;
  const ranges = mesh.userData.shipObjectRanges as ShipObjectRange[] | undefined;
  if (!ranges) return null;
  const vertex = faceIndex * 3;
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1, range = ranges[middle];
    if (vertex < range.start) high = middle - 1;
    else if (vertex >= range.start + range.count) low = middle + 1;
    else return range.object;
  }
  return null;
}

export function shipObjectHighlight(object: ShipObject) {
  const positions = new Float32Array(object.parts.reduce((sum, part) => sum + part.count * 3, 0));
  let offset = 0;
  for (const part of object.parts) {
    const source = part.mesh.geometry.getAttribute("position");
    for (let i = part.start; i < part.start + part.count; i++) {
      positions[offset++] = source.getX(i); positions[offset++] = source.getY(i); positions[offset++] = source.getZ(i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({ color: "#ffce7a", transparent: true, opacity: .38,
    side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.raycast = () => {}; // The glow must never become a second click target.
  return mesh;
}

export function shipObjectCameraPose(object: Pick<ShipObject, "bounds" | "deck">, width: number, height: number, position: THREE.Vector3, target: THREE.Vector3) {
  const center = object.bounds.getCenter(new THREE.Vector3()).add(new THREE.Vector3(0, object.deck * DECK_STEP, 0));
  const span = Math.max(1, object.bounds.getSize(new THREE.Vector3()).length());
  const side = width >= 768 ? 300 : 0, bottom = width < 768 ? 250 : 0;
  const zoom = Math.max(.2, Math.min(110, Math.max(64, width - side - 32) / (span + 2), Math.max(64, height - bottom - 48) / (span + 2)));
  const direction = position.clone().sub(target).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize(), up = direction.clone().cross(right).normalize();
  center.addScaledVector(right, side / (2 * zoom)).addScaledVector(up, -bottom / (2 * zoom));
  return { target: center, position: center.clone().addScaledVector(direction, Math.max(15, span * 2)), zoom };
}

export const SHIP_OBJECT_NOTES = [
  "Last inspected by a very serious duck.",
  "No alien life detected. Yet.",
  "Crew consensus: this one sparks joy.",
  "Has never missed a launch briefing.",
  "Please do not trade this for moon cheese.",
  "Quietly collecting stories from every voyage.",
] as const;
export function shipObjectNote(id: string) {
  let seed = 0;
  for (const char of id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return SHIP_OBJECT_NOTES[seed % SHIP_OBJECT_NOTES.length];
}
