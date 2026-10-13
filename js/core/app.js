import { Emitter } from './emitter.js';
import { Graph } from './graph.js';
import { evaluateEdges } from './analysis.js';
import { MODULES, getModule } from '../modules/index.js';
import { TIMELINE } from '../config.js';
import { clamp } from '../util/format.js';

export class App extends Emitter {
  constructor() {
    super();

    this.graph = new Graph();

    // transport
    this.t = TIMELINE.min;
    this.playing = false;
    this.speed = 1;
    this.loop = true;

    // editor
    this.tool = 'select';
    this.selection = null;     // { kind: 'node' | 'edge', id }
    this.pendingFrom = null;   // node id while drawing a link
    this.startNodeId = null;

    // modules
    this.tab = MODULES[0].id;
    this.moduleState = {};
    for (const module of MODULES) {
      this.moduleState[module.id] = { ...(module.defaults || {}) };
    }

    // derived
    this.edgeStates = new Map();
    this.result = null;
    this.view = { nodes: new Map(), edges: new Map() };
  }

  /* ------------------------------------------------------------- transport */

  get tMin() { return TIMELINE.min; }
  get tMax() { return TIMELINE.max; }

  get progress() {
    return (this.t - TIMELINE.min) / (TIMELINE.max - TIMELINE.min);
  }

  setTime(value, { recompute = true } = {}) {
    const next = clamp(value, TIMELINE.min, TIMELINE.max);
    if (next === this.t) return;
    this.t = next;
    if (recompute) this.recompute();
    else this.emit('transport');
  }

  play() {
    if (!this.loop && this.t >= TIMELINE.max - 1e-6) this.t = TIMELINE.min;
    this.playing = true;
    this.emit('transport');
  }

  pause() {
    this.playing = false;
    this.emit('transport');
  }

  togglePlay() {
    this.playing ? this.pause() : this.play();
  }

  setSpeed(speed) {
    this.speed = speed;
    this.emit('transport');
  }

  setLoop(loop) {
    this.loop = loop;
    this.emit('transport');
  }

  stepBy(delta) {
    this.pause();
    this.setTime(this.t + delta);
  }

  seekStart() { this.pause(); this.setTime(TIMELINE.min); }
  seekEnd()   { this.pause(); this.setTime(TIMELINE.max); }

  /**
   * Advance the transport clock. Called from the rAF loop in main.js.
   */
  advance(dtSeconds) {
    if (!this.playing) return;

    let next = this.t + dtSeconds * this.speed * TIMELINE.rate;

    if (next >= TIMELINE.max) {
      if (this.loop) {
        const span = TIMELINE.max - TIMELINE.min;
        next = TIMELINE.min + ((next - TIMELINE.min) % span);
      } else {
        next = TIMELINE.max;
        this.playing = false;
        this.emit('transport');
      }
    }

    this.t = next;
    this.recompute();
  }

  /* ------------------------------------------------------------------ tabs */

  setTab(id) {
    if (id === this.tab) return;
    this.tab = id;
    this.emit('tab', id);
    this.recompute();
  }

  get activeModule() {
    return getModule(this.tab);
  }

  /* --------------------------------------------------------------- editing */

  setTool(tool) {
    this.tool = tool;
    this.pendingFrom = null;
    this.emit('tool', tool);
    this.recompute();
  }

  select(selection) {
    this.selection = selection;
    this.emit('selection', selection);
    this.recompute();
  }

  setStartNode(nodeId) {
    this.startNodeId = nodeId;
    this.emit('selection', this.selection);
    this.recompute();
  }

  /** Clear references to entities that no longer exist. */
  validateReferences() {
    const valid = {
      node: id => !!this.graph.node(id),
      edge: id => !!this.graph.edge(id),
    };

    if (this.selection && !valid[this.selection.kind]?.(this.selection.id)) {
      this.selection = null;
      this.emit('selection', null);
    }
    if (this.startNodeId !== null && !this.graph.node(this.startNodeId)) {
      this.startNodeId = null;
    }
    if (this.pendingFrom !== null && !this.graph.node(this.pendingFrom)) {
      this.pendingFrom = null;
    }
  }

  afterGraphMutation() {
    this.validateReferences();
    this.recompute();
  }

  /* ------------------------------------------------------------- computing */

  moduleContext() {
    const module = this.activeModule;
    const state = this.moduleState[this.tab] ??= { ...(module.defaults || {}) };

    return {
      app: this,
      graph: this.graph,
      edgeStates: this.edgeStates,
      t: this.t,
      state,
      requestUpdate: () => this.recompute(),
    };
  }

  recompute() {
    this.edgeStates = evaluateEdges(this.graph, this.t);

    const module = this.activeModule;
    const context = this.moduleContext();

    let result;
    try {
      result = module.run(context) || {};
    } catch (err) {
      result = {
        nodes: new Map(),
        edges: new Map(),
        summary: [],
        output: { type: 'error', message: err.message },
      };
    }

    this.result = result;
    this.view = this.#composeView(result);
    this.emit('change');
  }

  #composeView(result) {
    const nodes = new Map();
    const edges = new Map();

    for (const node of this.graph.nodes) {
      nodes.set(node.id, [...(result.nodes?.get(node.id) || [])]);
      if (node.id === this.startNodeId) nodes.get(node.id).push('is-start');
    }

    for (const edge of this.graph.edges) {
      edges.set(edge.id, [...(result.edges?.get(edge.id) || [])]);
      const state = this.edgeStates.get(edge.id);
      if (!state || !state.active) edges.get(edge.id).push('is-inactive');
    }

    if (this.selection?.kind === 'node') nodes.get(this.selection.id)?.push('is-selected');
    if (this.selection?.kind === 'edge') edges.get(this.selection.id)?.push('is-selected');
    if (this.pendingFrom !== null) nodes.get(this.pendingFrom)?.push('is-pending');

    return { nodes, edges };
  }

  renderModel() {
    return {
      graph: this.graph,
      edgeStates: this.edgeStates,
      view: this.view,
      tool: this.tool,
      t: this.t,
    };
  }
}