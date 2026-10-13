import { h } from '../util/dom.js';
import { fmt } from '../util/format.js';
import { buildAdjacency, evaluateEdges } from '../core/analysis.js';
import { mulberry32 } from '../util/random.js';
import { TIMELINE } from '../config.js';

export const infectionModule = {
  id: 'infection',
  label: 'Infection',
  defaults: { beta: 0.35, gamma: 0.15, initialCount: 2, seed: 20240101 },

  buildControls(ctx) {
    const { state, requestUpdate } = ctx;
    return h('div', { class: 'stack' },
      slider('Transmission β', state.beta, 0, 1, 0.05, value => {
        state.beta = value;
        requestUpdate();
      }),
      slider('Recovery γ', state.gamma, 0, 1, 0.05, value => {
        state.gamma = value;
        requestUpdate();
      }),
      slider('Initial infected', state.initialCount, 1, 8, 1, value => {
        state.initialCount = value;
        requestUpdate();
      }),
      h('p', { class: 'hint' },
        'SIR model over the currently active links. Scrub the timeline to ' +
        'walk through the epidemic — the result is fully deterministic for a given seed.'),
    );
  },

  run({ graph, edgeStates, t, state }) {
    const nodes = new Map();
    const edges = new Map();

    if (graph.nodes.length === 0) {
      return { nodes, edges, summary: [], output: { type: 'empty' } };
    }

    const frames = simulate(graph, state);
    const index = Math.min(
      frames.length - 1,
      Math.max(0, Math.round(
        ((t - TIMELINE.min) / (TIMELINE.max - TIMELINE.min)) * (frames.length - 1)
      )),
    );
    const frame = frames[index];

    for (const [id, status] of frame.status) {
      if (status === 'I') nodes.set(id, ['is-infected']);
      else if (status === 'R') nodes.set(id, ['is-recovered']);
    }

    // Highlight the transmission routes out of currently infectious nodes.
    const adjacency = buildAdjacency(graph, edgeStates);
    for (const edge of graph.edges) {
      const edgeState = edgeStates.get(edge.id);
      if (!edgeState || !edgeState.active) continue;
      if (frame.status.get(edge.from) === 'I' || frame.status.get(edge.to) === 'I') {
        edges.set(edge.id, ['is-flagged']);
      }
    }

    return {
      nodes,
      edges,
      summary: [
        { label: 'susceptible', value: frame.susceptible },
        { label: 'infected', value: frame.infected },
        { label: 'recovered', value: frame.recovered },
      ],
      output: {
        type: 'sir',
        frames,
        index,
        infectedIds: [...frame.status].filter(([, s]) => s === 'I').map(([id]) => id),
      },
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

    return h('div', {},
      sparkline(output.frames, output.index),
      h('p', { class: 'hint', style: { marginTop: '8px' } },
        output.infectedIds.length
          ? 'Currently infected: ' + output.infectedIds.map(labelOf).join(', ')
          : 'No active infections at this point in time.'),
    );
  },
};

/* ------------------------------------------------------------ simulation */

function simulate(graph, options) {
  const steps = 24;
  const rng = mulberry32(options.seed);

  // Pre-compute the active adjacency at each simulation step.
  const adjacencyByStep = [];
  for (let step = 0; step <= steps; step++) {
    const t = TIMELINE.min + (step / steps) * (TIMELINE.max - TIMELINE.min);
    adjacencyByStep.push(buildAdjacency(graph, evaluateEdges(graph, t)));
  }

  const status = new Map(graph.nodes.map(node => [node.id, 'S']));

  // Pick initial infected deterministically.
  const pool = graph.nodes.map(n => n.id);
  const initial = [];
  for (let i = 0; i < Math.min(options.initialCount, pool.length); i++) {
    const index = Math.floor(rng() * pool.length);
    initial.push(pool.splice(index, 1)[0]);
  }
  for (const id of initial) status.set(id, 'I');

  const frames = [snapshot(new Map(status), 0)];

  for (let step = 1; step <= steps; step++) {
    const adjacency = adjacencyByStep[step];
    const previous = new Map(status);
    const next = new Map(previous);

    // Transmission: each infectious node can infect susceptible neighbours.
    for (const [id, state] of previous) {
      if (state !== 'I') continue;
      for (const { to } of adjacency.get(id) || []) {
        if (previous.get(to) === 'S' && rng() < options.beta) next.set(to, 'I');
      }
    }

    // Recovery: based on the *previous* state, so newly infected nodes
    // survive at least one full step before they can recover.
    for (const [id, state] of previous) {
      if (state === 'I' && rng() < options.gamma) next.set(id, 'R');
    }

    status.clear();
    for (const [id, value] of next) status.set(id, value);

    frames.push(snapshot(new Map(status), step));
  }

  return frames;
}

function snapshot(status, step) {
  let susceptible = 0, infected = 0, recovered = 0;

  for (const state of status.values()) {
    if (state === 'S') susceptible++;
    else if (state === 'I') infected++;
    else recovered++;
  }

  return { status, step, susceptible, infected, recovered };
}

/* --------------------------------------------------------------- helpers */

function sparkline(frames, currentIndex) {
  const width = 300;
  const height = 54;
  const maxInfected = Math.max(1, ...frames.map(f => f.infected));
  const count = frames.length;

  const points = frames
    .map((frame, index) => {
      const x = (index / (count - 1)) * width;
      const y = height - 4 - (frame.infected / maxInfected) * (height - 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const markerX = (currentIndex / (count - 1)) * width;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('points', `0,${height} ${points} ${width},${height}`);
  area.setAttribute('fill', '#eff4ff');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#2563eb');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');

  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  marker.setAttribute('x1', markerX);
  marker.setAttribute('x2', markerX);
  marker.setAttribute('y1', 0);
  marker.setAttribute('y2', height);
  marker.setAttribute('stroke', '#101828');
  marker.setAttribute('stroke-width', '1');
  marker.setAttribute('stroke-dasharray', '3 3');
  marker.setAttribute('vector-effect', 'non-scaling-stroke');

  svg.append(area, line, marker);
  return svg;
}

function slider(label, value, min, max, step, onChange) {
  const readout = h('span', { class: 'field-value' }, String(value));

  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    oninput: event => {
      const next = parseFloat(event.target.value);
      readout.textContent = String(next);
      onChange(next);
    },
  });

  return h('div', {},
    h('label', { class: 'field-label' }, label, readout),
    input,
  );
}