import { h } from '../util/dom.js';
import { fmt } from '../util/format.js';
import { buildAdjacency, evaluateEdges } from '../core/analysis.js';
import { mulberry32 } from '../util/random.js';
import { TIMELINE } from '../config.js';

// Должно совпадать с FORMULATION_T в config.js / app.js.
// Симуляция инфекции идёт только по пост-формуляционной части таймлайна.
const FORMULATION_T = 0;

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
        'SIR model over the currently active links. The simulation starts at ' +
        'the end of formulation (t = 0) and runs to the end of the timeline. ' +
        'The result is fully deterministic for a given seed.'),
    );
  },

  run({ graph, edgeStates, t, state }) {
    const nodes = new Map();
    const edges = new Map();

    if (graph.nodes.length === 0) {
      return { nodes, edges, summary: [], output: { type: 'empty' } };
    }

    const frames = simulate(graph, state);

    // Симуляция покрывает только [FORMULATION_T, TIMELINE.max].
    // t < FORMULATION_T (фаза формулировки) — показываем кадр 0.
    const span = TIMELINE.max - FORMULATION_T;
    const positiveT = Math.max(0, t - FORMULATION_T);
    const progress = span > 0 ? positiveT / span : 0;
    const index = Math.min(
      frames.length - 1,
      Math.max(0, Math.round(progress * (frames.length - 1))),
    );
    const frame = frames[index];

    for (const [id, status] of frame.status) {
      if (status === 'I') nodes.set(id, ['is-infected']);
      else if (status === 'R') nodes.set(id, ['is-recovered']);
    }

    // Подсвечиваем маршруты передачи из текущих заражённых нод.
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
    const output = result?.output;

    if (!output) {
      return h('div', { class: 'hint' }, '—');
    }

    if (output.type === 'empty') {
      return h('p', { class: 'hint' }, 'The graph is empty.');
    }

    if (output.type === 'error') {
      return h('p', { class: 'hint', style: { color: 'var(--err)' } }, output.message);
    }

    // Stale result from a previous tab — recompute() will catch up shortly.
    if (output.type !== 'sir') {
      return h('p', { class: 'hint' }, 'Waiting for simulation…');
    }

    const frames = output.frames || [];
    if (frames.length === 0) {
      return h('p', { class: 'hint' }, 'No simulation frames yet.');
    }

    const labelOf = id => ctx.graph.node(id)?.label ?? `#${id}`;

    const MAX_LIST = 12;
    const infected = output.infectedIds || [];
    const preview = infected.slice(0, MAX_LIST).map(labelOf).join(', ');
    const extra = infected.length > MAX_LIST
      ? ` … and ${infected.length - MAX_LIST} more`
      : '';

    return h('div', {},
      sparkline(frames, output.index ?? 0),
      h('p', { class: 'hint', style: { marginTop: '8px' } },
        infected.length
          ? 'Currently infected: ' + preview + extra
          : 'No active infections at this point in time.'),
    );
  },
};

/* ------------------------------------------------------------ simulation */

function simulate(graph, options) {
  const steps = 24;
  const rng = mulberry32(options.seed);

  // Семплируем ТОЛЬКО пост-формуляционную часть таймлайна:
  //   t = FORMULATION_T  …  TIMELINE.max
  // Раньше был [TIMELINE.min, TIMELINE.max], и негативная половина
  // (фаза формулировки) съедала половину симуляции.
  const adjacencyByStep = [];
  const span = TIMELINE.max - FORMULATION_T;
  for (let step = 0; step <= steps; step++) {
    const t = FORMULATION_T + (step / steps) * span;
    adjacencyByStep.push(buildAdjacency(graph, evaluateEdges(graph, t)));
  }

  const status = new Map(graph.nodes.map(node => [node.id, 'S']));

  // Детерминированный выбор изначально заражённых.
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

    // Передача: каждая заражённая нода может заразить восприимчивых соседей.
    for (const [id, state] of previous) {
      if (state !== 'I') continue;
      for (const { to } of adjacency.get(id) || []) {
        if (previous.get(to) === 'S' && rng() < options.beta) next.set(to, 'I');
      }
    }

    // Восстановление — по *предыдущему* состоянию, чтобы только что
    // заражённые прожили хотя бы один полный шаг.
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
  if (!frames || frames.length === 0) return h('div');

  if (frames.length === 1) {
    // Один кадр — плоская линия, чтобы не делить на 0.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sparkline');
    svg.setAttribute('viewBox', '0 0 300 54');
    svg.setAttribute('preserveAspectRatio', 'none');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', '300');
    line.setAttribute('y1', '27');
    line.setAttribute('y2', '27');
    line.setAttribute('stroke', '#2563eb');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('vector-effect', 'non-scaling-stroke');

    svg.append(line);
    return svg;
  }

  const width = 300;
  const height = 54;
  const maxInfected = Math.max(1, ...frames.map(f => f.infected || 0));
  const count = frames.length;
  const safeIndex = Math.max(0, Math.min(count - 1, currentIndex | 0));

  const points = frames
    .map((frame, index) => {
      const x = (index / (count - 1)) * width;
      const y = height - 4 - ((frame.infected || 0) / maxInfected) * (height - 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const markerX = (safeIndex / (count - 1)) * width;

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