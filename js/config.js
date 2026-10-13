export const CANVAS = {
  width: 1000,
  height: 640,
  margin: 46,
  nodeRadius: 18,
};

export const TIMELINE = {
  min: 0,
  max: 10,
  step: 0.25,     // one evaluation quantum
  rate: 1,        // units per second at speed 1x
};

export const INFECTION = {
  steps: 24,      // simulation steps spread across the whole timeline
  recoveryTime: 3,
};