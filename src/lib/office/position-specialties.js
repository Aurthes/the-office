"use strict";
// One built-in position catalog for the role context and editable title suggestions.
// A specialty describes work; it does not grant permissions or require review.
const WORKER_SPECIALTIES = {
  Ops: "Daily running, monitoring and maintenance.",
  Dev: "Coding, implementation and software development.",
  Quant: "Mathematical/statistical research and analysis.",
  Auditor: "Independently review goal understanding, whether question breakdown advances the core goal, scope, the shortest proportionate path and over-engineering. Implementation correctness and technical validation remain with the executor; this role adds no mandatory QA approval.",
};
const POSITION_TITLES = ["Worker", "Head", "Manager", ...Object.keys(WORKER_SPECIALTIES)];
module.exports = { WORKER_SPECIALTIES, POSITION_TITLES };
