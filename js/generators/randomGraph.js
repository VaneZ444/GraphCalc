import { mulberry32, pick, randFloat } from '../util/random.js';
import { CANVAS } from '../config.js';
import { fmt } from '../util/format.js';

const CONDITION_TEMPLATES = [
  () => '1',
  rng => `t > ${fmt(randFloat(rng, 1, 7), 1)}`,
  rng => `t < ${fmt(randFloat(rng, 2, 8), 1)}`,
  rng => `t^{2} - ${fmt(randFloat(rng, 1, 16), 1)} > 0`,
  rng => `\\sin(t - ${fmt(randFloat(rng, 0, 3), 1)}) > 0`,
  rng => {
    const a = fmt(randFloat(rng, 1, 4), 1);
    const b = fmt(randFloat(rng, 5, 9), 1);
    return `(t - ${a})(t - ${b}) < 0`;
  },
  rng => fmt(randFloat(rng, 0.5, 3), 1),
  rng => `\\lvert t - ${fmt(randFloat(rng, 2, 7), 1)} \\rvert > 1`,
];

/**
 * Populate `graph` with a random network.
 *
 * @param {Graph} graph
 * @param {object} options
 * @param {number} options.nodeCount
 * @param {number} options.edgeProbability
 * @param {number} options.seed
 * @param {'circle'|'grid'|'scatter'} options.layout
 * @param {boolean} options.conditions   attach random time conditions
 */
export function generateRandomGraph(graph, options = {}) {
  const {
    nodeCount = 10,
    edgeProbability = 0.25,
    seed = 1,
    layout = 'circle',
    conditions = true,
  } = options;

  const rng = mulberry32(seed);
  graph.clear();

  const positions = layoutPositions(layout, nodeCount, rng);
  const nodes = positions.map(position => graph.addNode(position.x, position.y));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (rng() >= edgeProbability) continue;

      const condition = conditions
        ? pick(rng, CONDITION_TEMPLATES)(rng)
        : '';

      graph.addEdge(nodes[i].id, nodes[j].id, condition);
    }
  }

  return graph;
}

/* --------------------------------------------------------------- layouts */

function layoutPositions(layout, count, rng) {
  const { width, height, margin } = CANVAS;
  const cx = width / 2;
  const cy = height / 2;
  const radiusX = (width - margin * 2) / 2;
  const radiusY = (height - margin * 2) / 2;

  if (layout === 'circle') {
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      return {
        x: cx + Math.cos(angle) * radiusX * 0.86,
        y: cy + Math.sin(angle) * radiusY * 0.86,
      };
    });
  }

  if (layout === 'grid') {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const stepX = (width - margin * 2) / Math.max(1, columns - 1 || 1);
    const stepY = (height - margin * 2) / Math.max(1, rows - 1 || 1);

    return Array.from({ length: count }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        x: margin + column * stepX,
        y: margin + row * stepY,
      };
    });
  }

  // scatter — rejection sampling keeps nodes reasonably apart
  const placed = [];
  const minDistance = 62;
  let guard = 0;

  while (placed.length < count && guard < count * 400) {
    guard++;
    const candidate = {
      x: margin + rng() * (width - margin * 2),
      y: margin + rng() * (height - margin * 2),
    };
    const tooClose = placed.some(p =>
      Math.hypot(p.x - candidate.x, p.y - candidate.y) < minDistance);
    if (!tooClose) placed.push(candidate);
  }

  return placed;
}