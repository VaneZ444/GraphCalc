// js/config.js

export const CANVAS = {
  width: 1000,
  height: 640,
  margin: 46,
  nodeRadius: 18,
};

export const TIMELINE = {
  min: -10,
  max: 10,
  step: 0.25,
  rate: 1,
};

/**
 * Time at which formulation completes. Everything below is the step-by-step
 * merge animation; everything above runs the algorithm on the merged graph.
 */
export const FORMULATION_T = 0;

export const INFECTION = {
  steps: 24,
  recoveryTime: 3,
};