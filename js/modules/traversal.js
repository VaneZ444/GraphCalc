import { h } from '../util/dom.js';
import { fmt } from '../util/format.js';
import { buildAdjacency, edgeWeight } from '../core/analysis.js';

const ALGORITHMS = [
  { id: 'dfs', label: 'DFS — depth-first search' },
  { id: 'bfs', label: 'BFS — breadth-first search' },
  { id: 'dijkstra', label: 'Dijkstra — shortest path' },
  { id: 'components', label: 'Connected components' },
];

export const traversalModule = {
  id: 'traversal',
  label: 'Traversal',
  defaults: { algorithm: 'dfs' },

  buildControls(ctx) {
    const { state, requestUpdate, app } = ctx;

    const select = h('select', {
      class: 'field',
      onchange: event => {
        state.algorithm = event.target.value;
        requestUpdate();
      },
    }, ...ALGORITHMS.map(a =>
      h('option', { value: a.id, selected: state.algorithm === a.id }, a.label)));

    const startInfo = h('p', { class: 'hint' });
    const refresh = () => {
      const start = app.graph.node(app.startNodeId) || app.graph.nodes[0];
      startInfo.textContent = start
        ? `Start node: ${start.label}. Shift-click a node to change it.`
        : 'Add at least one node to run a traversal.';
    };
    refresh();
    app.on('selection', refresh);

    return h('div', { class: 'stack' },
      h('label', { class: 'field-label' }, 'Algorithm'),
      select,
      startInfo,
    );
  },

  run({ graph, edgeStates, state, app }) {
    const nodes = new Map();
    const edges = new Map();

    if (graph.nodes.length === 0) {
      return { nodes, edges, summary: [{ label: 'nodes', value: 0 }], output: { type: 'empty' } };
    }

    const adjacency = buildAdjacency(graph, edgeStates);
    const startId = graph.node(app.startNodeId) ? app.startNodeId : graph.nodes[0].id;

    let output;
    const visited = new Set();

    if (state.algorithm === 'dfs' || state.algorithm === 'bfs') {
      const walk = state.algorithm === 'dfs'
        ? dfs(startId, adjacency, visited)
        : bfs(startId, adjacency, visited);

      walk.order.forEach((id, index) => {
        const tokens = ['is-visited'];
        if (index === 0) tokens.push('is-start');
        nodes.set(id, tokens);
      });
      for (const edgeId of walk.treeEdges) edges.set(edgeId, ['is-tree']);

      output = {
        type: 'order',
        order: walk.order,
        unreachable: graph.nodes.filter(n => !visited.has(n.id)).map(n => n.id),
      };
    } else if (state.algorithm === 'dijkstra') {
      const distances = new Map();
      const previous = new Map();
      const settled = new Set();

      for (const node of graph.nodes) distances.set(node.id, Infinity);
      distances.set(startId, 0);

      const queue = [[0, startId]];
      const order = [];

      while (queue.length) {
        queue.sort((a, b) => a[0] - b[0]);
        const [distance, current] = queue.shift();
        if (settled.has(current)) continue;

        settled.add(current);
        order.push(current);

        const previousEntry = previous.get(current);
        if (previousEntry) edges.set(previousEntry.edgeId, ['is-tree']);

        for (const { to, edge } of adjacency.get(current) || []) {
          const weight = edgeWeight(edgeStates, edge.id, 1);
          const candidate = distance + weight;
          if (candidate < (distances.get(to) ?? Infinity)) {
            distances.set(to, candidate);
            previous.set(to, { node: current, edgeId: edge.id });
            queue.push([candidate, to]);
          }
        }
      }

      for (const id of order) {
        nodes.set(id, id === startId ? ['is-visited', 'is-start'] : ['is-visited']);
      }

      output = {
        type: 'distances',
        rows: order.map(id => ({ id, distance: distances.get(id) })),
      };
      visited.clear();
      order.forEach(id => visited.add(id));
    } else {
      const components = [];
      for (const node of graph.nodes) {
        if (visited.has(node.id)) continue;
        const walk = dfs(node.id, adjacency, visited);
        components.push(walk.order);
        for (const id of walk.order) nodes.set(id, ['is-visited']);
        for (const edgeId of walk.treeEdges) edges.set(edgeId, ['is-tree']);
      }
      output = { type: 'components', components };
    }

    return {
      nodes,
      edges,
      summary: [
        { label: 'active links', value: `${countActive(edgeStates)} / ${graph.edges.length}` },
        { label: 'reached nodes', value: `${visited.size} / ${graph.nodes.length}` },
      ],
      output,
    };
  },

  renderOutput(result, ctx) {
    const output = result.output;
    if (!output) return h('div', { class: 'hint' }, 'No result.');

    const labelOf = id => ctx.graph.node(id)?.label ?? `#${id}`;

    if (output.type === 'empty') {
      return h('p', { class: 'hint' }, 'The graph is empty. Add nodes or generate a random graph.');
    }

    if (output.type === 'error') {
      return h('p', { class: 'hint', style: { color: 'var(--err)' } }, output.message);
    }

    if (output.type === 'order') {
      const chain = [];
      output.order.forEach((id, index) => {
        if (index > 0) chain.push(h('span', { class: 'arrow' }, '→'));
        chain.push(h('span', { class: 'token' }, labelOf(id)));
      });

      return h('div', {},
        h('div', { class: 'order-line' }, ...chain),
        output.unreachable.length
          ? h('p', { class: 'hint', style: { marginTop: '10px' } },
              'Unreachable: ' + output.unreachable.map(labelOf).join(', '))
          : null,
      );
    }

    if (output.type === 'distances') {
      return h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Node'), h('th', {}, 'Distance'))),
        h('tbody', {}, ...output.rows.map(row =>
          h('tr', {},
            h('td', {}, labelOf(row.id)),
            h('td', {}, Number.isFinite(row.distance) ? fmt(row.distance) : '∞'),
          ))),
      );
    }

    if (output.type === 'components') {
      return h('div', {}, ...output.components.map((component, index) =>
        h('div', { class: 'order-line' },
          h('span', { class: 'badge neutral' }, `C${index + 1}`),
          ...component.map(id => h('span', { class: 'token' }, labelOf(id))),
        )));
    }

    return h('div');
  },
};

/* --------------------------------------------------------------- helpers */

function dfs(startId, adjacency, visited) {
  const order = [];
  const treeEdges = new Set();
  const stack = [{ node: startId, from: null }];

  while (stack.length) {
    const { node, from } = stack.pop();
    if (visited.has(node)) continue;

    visited.add(node);
    order.push(node);
    if (from) treeEdges.add(from.edgeId);

    const neighbours = adjacency.get(node) || [];
    for (let i = neighbours.length - 1; i >= 0; i--) {
      if (!visited.has(neighbours[i].to)) {
        stack.push({ node: neighbours[i].to, from: { edgeId: neighbours[i].edge.id } });
      }
    }
  }

  return { order, treeEdges };
}

function bfs(startId, adjacency, visited) {
  const order = [];
  const treeEdges = new Set();
  const queue = [{ node: startId, from: null }];

  while (queue.length) {
    const { node, from } = queue.shift();
    if (visited.has(node)) continue;

    visited.add(node);
    order.push(node);
    if (from) treeEdges.add(from.edgeId);

    for (const neighbour of adjacency.get(node) || []) {
      if (!visited.has(neighbour.to)) {
        queue.push({ node: neighbour.to, from: { edgeId: neighbour.edge.id } });
      }
    }
  }

  return { order, treeEdges };
}

function countActive(edgeStates) {
  let count = 0;
  for (const state of edgeStates.values()) if (state.active) count++;
  return count;
}