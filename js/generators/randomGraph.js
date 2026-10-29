// js/generators/randomGraph.js

import { mulberry32, pick, randFloat, shuffle } from '../util/random.js';
import { CANVAS } from '../config.js';
import { fmt } from '../util/format.js';
import { Graph } from '../core/graph.js';
import { GraphSet } from '../core/graphSet.js';

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

function randomCondition(rng) {
  return pick(rng, CONDITION_TEMPLATES)(rng);
}

/* --------------------------------------------------------------- single */

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
  const nodes = positions.map(p => graph.addNode(p.x, p.y));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (rng() >= edgeProbability) continue;
      graph.addEdge(nodes[i].id, nodes[j].id, conditions ? randomCondition(rng) : '');
    }
  }
  return graph;
}

/* ------------------------------------------------------------ graph set */

export function generateGraphSet(options = {}) {
  const {
    count = 5,
    nodesPerGraph = 4,
    edgeProbability = 0.5,
    namePoolSize = 10,
    seed = 1,
    conditions = true,
  } = options;

  const rng = mulberry32(seed);
  const namePool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .slice(0, Math.min(26, Math.max(2, namePoolSize)));

  const set = new GraphSet();

  for (let i = 0; i < count; i++) {
    const g = new Graph();
    const k = Math.min(nodesPerGraph, namePool.length);
    const names = shuffle(rng, namePool).slice(0, k);

    // Give each source graph a proper circular layout so it looks correct
    // when the user opens it for editing.
    const positions = layoutPositions('circle', k, rng);
    names.forEach((name, j) => {
      g.addNode(positions[j].x, positions[j].y, name);
    });

    for (let a = 0; a < g.nodes.length; a++) {
      for (let b = a + 1; b < g.nodes.length; b++) {
        if (rng() < edgeProbability) {
          g.addEdge(g.nodes[a].id, g.nodes[b].id,
                    conditions ? randomCondition(rng) : '');
        }
      }
    }
    set.add(g, `Graph ${i + 1}`);
  }
  return set;
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
    return Array.from({ length: count }, (_, index) => ({
      x: margin + (index % columns) * stepX,
      y: margin + Math.floor(index / columns) * stepY,
    }));
  }
  const placed = [];
  const minDistance = 62;
  let guard = 0;
  while (placed.length < count && guard < count * 400) {
    guard++;
    const candidate = {
      x: margin + rng() * (width - margin * 2),
      y: margin + rng() * (height - margin * 2),
    };
    if (!placed.some(p => Math.hypot(p.x - candidate.x, p.y - candidate.y) < minDistance)) {
      placed.push(candidate);
    }
  }
  return placed;
}