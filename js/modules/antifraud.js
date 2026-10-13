import { h } from '../util/dom.js';
import { fmt } from '../util/format.js';
import { buildAdjacency } from '../core/analysis.js';

export const antifraudModule = {
  id: 'antifraud',
  label: 'Anti-fraud',
  defaults: { degreeWeight: 0.6, cycleWeight: 0.4, threshold: 0.5 },

  buildControls(ctx) {
    const { state, requestUpdate } = ctx;
    return h('div', { class: 'stack' },
      slider('Degree weight', state.degreeWeight, 0, 1, 0.05, value => {
        state.degreeWeight = value;
        requestUpdate();
      }),
      slider('Cycle weight', state.cycleWeight, 0, 1, 0.05, value => {
        state.cycleWeight = value;
        requestUpdate();
      }),
      slider('Flag threshold', state.threshold, 0.1, 1, 0.05, value => {
        state.threshold = value;
        requestUpdate();
      }),
      h('p', { class: 'hint' },
        'Nodes inside a dense cycle (the 2-core of the active subgraph) and ' +
        'high-degree hubs receive the highest risk scores.'),
    );
  },

  run({ graph, edgeStates, state }) {
    const nodes = new Map();
    const edges = new Map();

    if (graph.nodes.length === 0) {
      return { nodes, edges, summary: [], output: { type: 'empty' } };
    }

    const adjacency = buildAdjacency(graph, edgeStates);

    const degree = new Map();
    for (const [id, neighbours] of adjacency) degree.set(id, neighbours.length);

    const maxDegree = Math.max(1, ...degree.values());
    const core = findCore(adjacency);

    const scores = [];
    for (const node of graph.nodes) {
      const d = degree.get(node.id) || 0;
      const inCore = core.has(node.id);

      const score = state.degreeWeight * (d / maxDegree) +
                    state.cycleWeight * (inCore ? 1 : 0);

      scores.push({ id: node.id, score, degree: d, inCore });

      if (score >= state.threshold) {
        nodes.set(node.id, ['is-flagged']);
      } else if (score >= state.threshold * 0.6 && score > 0) {
        nodes.set(node.id, ['is-watch']);
      }
    }

    // Highlight links that live entirely inside the suspicious core.
    for (const edge of graph.edges) {
      const edgeState = edgeStates.get(edge.id);
      if (!edgeState || !edgeState.active) continue;
      if (core.has(edge.from) && core.has(edge.to)) {
        edges.set(edge.id, ['is-flagged']);
      }
    }

    scores.sort((a, b) => b.score - a.score);

    return {
      nodes,
      edges,
      summary: [
        { label: 'nodes in cycles', value: `${core.size} / ${graph.nodes.length}` },
        { label: 'flagged', value: scores.filter(s => s.score >= state.threshold).length },
        { label: 'max degree', value: maxDegree },
      ],
      output: { type: 'risk', rows: scores },
    };
  },

  renderOutput(result, ctx) {
    const output = result.output;
    if (!output) return h('div');

    if (output.type === 'empty') {
      return h('p', { class: 'hint' }, 'The graph is empty.');
    }

    if (output.type === 'error') {
      return h('p', { class: 'hint', style: { color: 'var(--err)' } }, output.message);
    }

    const labelOf = id => ctx.graph.node(id)?.label ?? `#${id}`;
    const threshold = ctx.state.threshold;

    return h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Node'),
        h('th', {}, 'Risk'),
        h('th', {}, 'Deg'),
        h('th', {}, ''),
      )),
      h('tbody', {}, ...output.rows.slice(0, 14).map(row => {
        const level = row.score >= threshold ? 'is-high'
          : row.score >= threshold * 0.6 ? 'is-mid' : '';

        return h('tr', {},
          h('td', {}, labelOf(row.id)),
          h('td', {}, fmt(row.score, 2)),
          h('td', {}, row.degree),
          h('td', {},
            h('div', { class: `risk-bar ${level}` },
              h('span', { style: { width: `${Math.min(100, row.score * 100)}%` } }))),
        );
      })),
    );
  },
};

/* --------------------------------------------------------------- helpers */

/**
 * Iteratively prune leaves — whatever survives is the 2-core, i.e. the set of
 * nodes that participate in at least one cycle.
 */
function findCore(adjacency) {
  const degree = new Map();
  for (const [id, neighbours] of adjacency) degree.set(id, neighbours.length);

  const removed = new Set();
  const queue = [];
  for (const [id, d] of degree) if (d <= 1) queue.push(id);

  while (queue.length) {
    const id = queue.shift();
    if (removed.has(id)) continue;
    removed.add(id);

    for (const { to } of adjacency.get(id) || []) {
      if (removed.has(to)) continue;
      const next = degree.get(to) - 1;
      degree.set(to, next);
      if (next <= 1) queue.push(to);
    }
  }

  const core = new Set();
  for (const id of adjacency.keys()) if (!removed.has(id)) core.add(id);
  return core;
}

function slider(label, value, min, max, step, onChange) {
  const readout = h('span', { class: 'field-value' }, value.toFixed(2));

  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    oninput: event => {
      const next = parseFloat(event.target.value);
      readout.textContent = next.toFixed(2);
      onChange(next);
    },
  });

  return h('div', {},
    h('label', { class: 'field-label' }, label, readout),
    input,
  );
}