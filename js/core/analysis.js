import { compile } from './math.js';

/**
 * Evaluate every edge condition at time `t`.
 * Returns Map<edgeId, { active, value, error }>.
 *
 * The rule: an empty condition means "always active".
 * A non-empty condition activates the link iff it evaluates to a non-zero number.
 */
export function evaluateEdges(graph, t) {
  const states = new Map();

  for (const edge of graph.edges) {
    const source = (edge.condition || '').trim();

    if (!source) {
      states.set(edge.id, { active: true, value: 1, error: null });
      continue;
    }

    try {
      const value = compile(source)({ t });

      if (typeof value !== 'number' || Number.isNaN(value)) {
        states.set(edge.id, { active: false, value: NaN, error: 'not a number' });
      } else {
        states.set(edge.id, { active: value !== 0, value, error: null });
      }
    } catch (err) {
      states.set(edge.id, { active: false, value: NaN, error: err.message });
    }
  }

  return states;
}

/**
 * Undirected adjacency over *active* edges only.
 */
export function buildAdjacency(graph, edgeStates) {
  const adjacency = new Map();
  for (const node of graph.nodes) adjacency.set(node.id, []);

  for (const edge of graph.edges) {
    const state = edgeStates.get(edge.id);
    if (!state || !state.active) continue;
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;

    adjacency.get(edge.from).push({ to: edge.to, edge });
    adjacency.get(edge.to).push({ to: edge.from, edge });
  }

  return adjacency;
}

/**
 * Directed adjacency over *active* edges only.
 */
export function buildDirectedAdjacency(graph, edgeStates) {
  const adjacency = new Map();
  for (const node of graph.nodes) adjacency.set(node.id, []);

  for (const edge of graph.edges) {
    const state = edgeStates.get(edge.id);
    if (!state || !state.active) continue;
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from).push({ to: edge.to, edge });
  }

  return adjacency;
}

/**
 * Numeric weight of an edge, derived from its condition value.
 */
export function edgeWeight(edgeStates, edgeId, fallback = 1) {
  const state = edgeStates.get(edgeId);
  if (!state || typeof state.value !== 'number' || !Number.isFinite(state.value)) return fallback;
  return Math.abs(state.value);
}