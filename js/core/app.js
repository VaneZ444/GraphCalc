// js/core/app.js

import { Emitter } from './emitter.js';
import { Graph } from './graph.js';
import { GraphSet, combineComponents } from './graphSet.js';
import { evaluateEdges } from './analysis.js';
import { MODULES, getModule } from '../modules/index.js';
import { TIMELINE, CANVAS } from '../config.js';
import { clamp } from '../util/format.js';

const MERGE_T = 1;

export class App extends Emitter {
  constructor() {
    super();

    this.graphSet = new GraphSet();
    this.components = [];
    this.unifiedGraph = new Graph();
    this._previewCache = null;
    this._previewOrigin = null;

    /** null = merged view; number = source graph index being edited */
    this.editingSourceIndex = null;

    this.t = TIMELINE.min;
    this.playing = false;
    this.speed = 1;
    this.loop = true;

    this.tool = 'select';
    this.selection = null;
    this.pendingFrom = null;
    this.startNodeId = null;

    this.tab = MODULES[0].id;
    this.moduleState = {};
    for (const m of MODULES) this.moduleState[m.id] = { ...(m.defaults || {}) };

    this.edgeStates = new Map();
    this.result = null;
    this.view = { nodes: new Map(), edges: new Map() };
  }

  /* ------------------------------------------------------- edit target */

  /**
   * The graph currently being edited on the canvas: a source graph when
   * the user has entered source-edit mode, otherwise the unified graph.
   */
  getEditGraph() {
    if (this.editingSourceIndex !== null) {
      return this.graphSet.graphs[this.editingSourceIndex]?.graph || null;
    }
    return this.unifiedGraph;
  }

  get graph() { return this.getEditGraph() || this.unifiedGraph; }

  get isFormulated() { return this.t >= MERGE_T; }

  /** True when the user is inside a source graph editor. */
  get isEditingSource() { return this.editingSourceIndex !== null; }

  /** Edge states for whatever graph is currently being edited. */
  get currentEdgeStates() {
    if (this.editingSourceIndex === null) return this.edgeStates;
    const g = this.getEditGraph();
    if (!g) return new Map();
    return evaluateEdges(g, this.t);
  }

  /* ------------------------------------------------------- graph set */
  
  invalidatePreview() {
    this._previewCache = null;
    this._previewOrigin = null;
  }

  setGraphSet(set) {
    this.graphSet = set;
    this.editingSourceIndex = null;
    this.formulate();
  }

  formulate({ preserveSelection = false } = {}) {
    this.components = this.graphSet.formulate();
    this.unifiedGraph = combineComponents(this.components, CANVAS);
    this.invalidatePreview();
    this.startNodeId = null;
    this._previewCache = null;
    this._previewOrigin = null;

    // Merged graph IDs are regenerated on every formulation — any
    // reference into the old unified graph is now stale.
    this.startNodeId = null;

    if (!preserveSelection) {
      this.selection = null;
      this.pendingFrom = null;
      this.emit('selection', null);
    }

    this.validateReferences();
    this.recompute();
  }

  /** Any mutation on a source graph: rebuild the merged graph in place. */
  afterSourceMutation() {
    this.formulate({ preserveSelection: true });
  }

  clearAll() {
    this.graphSet.clear();
    this.components = [];
    this.unifiedGraph = new Graph();
    this._previewCache = null;
    this._previewOrigin = null;
    this.editingSourceIndex = null;
    this.selection = null;
    this.startNodeId = null;
    this.pendingFrom = null;
    this.emit('selection', null);
    this.recompute();
  }

  /* --------------------------------------------------- source editing */

  editSource(index) {
    if (index !== null) {
      if (index < 0 || index >= this.graphSet.size) index = null;
    }
    this.editingSourceIndex = index;
    this.selection = null;
    this.pendingFrom = null;
    this.startNodeId = null;
    this.emit('selection', null);
    this.recompute();
  }

    addSource(initialNode = null) {
    const g = new Graph();
    let newNode = null;

    if (initialNode) {
      // Pick a label that no other source is using, so the manual node
      // does not silently merge into an existing auto-generated one.
      const label = this.graphSet.nextUnusedLabel();
      newNode = g.addNode(initialNode.x, initialNode.y, label);
    }

    const n = this.graphSet.size + 1;
    this.graphSet.add(g, `Graph ${n}`);

    this.editingSourceIndex = this.graphSet.size - 1;
    this.selection = newNode ? { kind: 'node', id: newNode.id } : null;
    this.pendingFrom = null;
    this.startNodeId = null;

    this.formulate({ preserveSelection: true });
  }
    /** Force the pre-merge preview grid to rebuild on the next render. */
  invalidatePreview() {
    this._previewCache = null;
    this._previewOrigin = null;
  }

  /** Replace the entire graph of an existing source (used by the text editor). */
  replaceSourceGraph(index, newGraph) {
    const entry = this.graphSet.graphs[index];
    if (!entry) return;

    entry.graph = newGraph;
    this.selection = null;
    this.pendingFrom = null;
    this.formulate();
    // formulate preserves editingSourceIndex — we're still editing this source.
  }

  /** Append a new source built from an already-constructed Graph. */
  addSourceFromGraph(newGraph) {
    const n = this.graphSet.size + 1;
    this.graphSet.add(newGraph, `Graph ${n}`);

    this.editingSourceIndex = this.graphSet.size - 1;
    this.selection = null;
    this.pendingFrom = null;
    this.startNodeId = null;

    this.formulate();
  }
  
  removeSource(index) {
    if (index < 0 || index >= this.graphSet.size) return;
    const id = this.graphSet.graphs[index].id;
    this.graphSet.remove(id);

    if (this.editingSourceIndex === index) {
      this.editingSourceIndex = null;
    } else if (this.editingSourceIndex !== null && this.editingSourceIndex > index) {
      this.editingSourceIndex--;
    }

    this.selection = null;
    this.startNodeId = null;
    this.pendingFrom = null;
    this.emit('selection', null);
    this.formulate();
  }

  /* --------------------------------------------------------- transport */

  get tMin() { return TIMELINE.min; }
  get tMax() { return TIMELINE.max; }
  get progress() { return (this.t - TIMELINE.min) / (TIMELINE.max - TIMELINE.min); }

  setTime(value, { recompute = true } = {}) {
    const next = clamp(value, TIMELINE.min, TIMELINE.max);
    if (next === this.t) return;

    const wasBelow = this.t < MERGE_T;
    this.t = next;

    if (wasBelow && next >= MERGE_T && this.editingSourceIndex !== null) {
      this.editingSourceIndex = null;
      this.selection = null;
      this.pendingFrom = null;
      this.emit('selection', null);
    }

    if (recompute) this.recompute();
    else this.emit('transport');
  }

  play() {
    if (!this.loop && this.t >= TIMELINE.max - 1e-6) this.t = TIMELINE.min;
    this.playing = true;
    this.emit('transport');
  }
  pause() { this.playing = false; this.emit('transport'); }
  togglePlay() { this.playing ? this.pause() : this.play(); }
  setSpeed(s) { this.speed = s; this.emit('transport'); }
  setLoop(b) { this.loop = b; this.emit('transport'); }
  stepBy(d) { this.pause(); this.setTime(this.t + d); }
  seekStart() { this.pause(); this.setTime(TIMELINE.min); }
  seekEnd()   { this.pause(); this.setTime(TIMELINE.max); }

  advance(dt) {
    if (!this.playing) return;

    let next = this.t + dt * this.speed * TIMELINE.rate;

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

    const wasBelow = this.t < MERGE_T;
    this.t = next;

    if (wasBelow && next >= MERGE_T && this.editingSourceIndex !== null) {
      this.editingSourceIndex = null;
      this.selection = null;
      this.pendingFrom = null;
      this.emit('selection', null);
    }

    this.recompute();
  }

  /* -------------------------------------------------------------- tabs */

  setTab(id) {
    if (id === this.tab) return;
    this.tab = id;
    this.emit('tab', id);
    this.recompute();
  }
  get activeModule() { return getModule(this.tab); }

  /* ----------------------------------------------------------- editing */

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
    if (this.editingSourceIndex !== null) return; // not meaningful for sources
    this.startNodeId = nodeId;
    this.emit('selection', this.selection);
    this.recompute();
  }

  validateReferences() {
    const g = this.getEditGraph();
    if (!g) return;

    const valid = {
      node: id => !!g.node(id),
      edge: id => !!g.edge(id),
    };
    if (this.selection && !valid[this.selection.kind]?.(this.selection.id)) {
      this.selection = null;
      this.emit('selection', null);
    }
    if (this.startNodeId !== null && !this.unifiedGraph.node(this.startNodeId)) {
      this.startNodeId = null;
    }
    if (this.pendingFrom !== null && !g.node(this.pendingFrom)) {
      this.pendingFrom = null;
    }
  }

  afterGraphMutation() {
    this.validateReferences();
    this.recompute();
  }

  /* --------------------------------------------------------- computing */

  moduleContext() {
    const module = this.activeModule;
    const state = this.moduleState[this.tab] ??= { ...(module.defaults || {}) };
    return {
      app: this,
      graph: this.unifiedGraph,   // algorithms always see the merged graph
      edgeStates: this.edgeStates,
      t: this.t,
      state,
      requestUpdate: () => this.recompute(),
    };
  }

  recompute() {
    this.edgeStates = this.isFormulated
      ? evaluateEdges(this.unifiedGraph, this.t)
      : new Map(this.unifiedGraph.edges.map(e =>
          [e.id, { active: false, value: 0, error: null }]));

    let result;
    try {
      result = this.activeModule.run(this.moduleContext()) || {};
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

    for (const node of this.unifiedGraph.nodes) {
      nodes.set(node.id, [...(result.nodes?.get(node.id) || [])]);
      if (node.id === this.startNodeId) nodes.get(node.id).push('is-start');
    }
    for (const edge of this.unifiedGraph.edges) {
      edges.set(edge.id, [...(result.edges?.get(edge.id) || [])]);
      const st = this.edgeStates.get(edge.id);
      if (!st || !st.active) edges.get(edge.id).push('is-inactive');
    }

    if (this.editingSourceIndex === null) {
      if (this.selection?.kind === 'node') nodes.get(this.selection.id)?.push('is-selected');
      if (this.selection?.kind === 'edge') edges.get(this.selection.id)?.push('is-selected');
      if (this.pendingFrom !== null) nodes.get(this.pendingFrom)?.push('is-pending');
    }

    return { nodes, edges };
  }

  #composeSourceView(sourceGraph, edgeStates) {
    const nodes = new Map();
    const edges = new Map();

    for (const node of sourceGraph.nodes) {
      const tokens = [];
      if (this.selection?.kind === 'node' && this.selection.id === node.id) {
        tokens.push('is-selected');
      }
      if (this.pendingFrom === node.id) tokens.push('is-pending');
      nodes.set(node.id, tokens);
    }

    for (const edge of sourceGraph.edges) {
      const tokens = [];
      const st = edgeStates.get(edge.id);
      if (!st || !st.active) tokens.push('is-inactive');
      if (this.selection?.kind === 'edge' && this.selection.id === edge.id) {
        tokens.push('is-selected');
      }
      edges.set(edge.id, tokens);
    }

    return { nodes, edges };
  }

  /* --------------------------------------------------------- rendering */

  renderModel() {
    // 1) Editing a source graph directly
    if (this.editingSourceIndex !== null) {
      const sourceGraph = this.getEditGraph();
      if (sourceGraph) {
        const states = evaluateEdges(sourceGraph, this.t);
        return {
          graph: sourceGraph,
          edgeStates: states,
          view: this.#composeSourceView(sourceGraph, states),
          tool: this.tool,
          t: this.t,
          phase: 'edit-source',
        };
      }
    }

    // 2) Pre-merge preview grid
    if (!this.isFormulated) {
      return {
        graph: this.sourcePreviewGraph(),
        edgeStates: new Map(),
        view: { nodes: new Map(), edges: new Map() },
        tool: 'select',
        t: this.t,
        phase: 'formulating',
      };
    }

    // 3) Merged view
    return {
      graph: this.unifiedGraph,
      edgeStates: this.edgeStates,
      view: this.view,
      tool: this.tool,
      t: this.t,
      phase: 'merged',
    };
  }

  sourcePreviewGraph() {
    if (this._previewCache) return this._previewCache;

    const preview = new Graph();
    const originMap = new Map();
    const graphs = this.graphSet.graphs;
    if (!graphs.length) {
      this._previewCache = preview;
      this._previewOrigin = originMap;
      return preview;
    }

    const cols = Math.ceil(Math.sqrt(graphs.length));
    const rows = Math.ceil(graphs.length / cols);
    const cellW = CANVAS.width / cols;
    const cellH = CANVAS.height / rows;
    const pad = 42;

    graphs.forEach((entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = col * cellW + cellW / 2;
      const cy = row * cellH + cellH / 2;
      const radius = Math.min(cellW, cellH) / 2 - pad;

      const localMap = new Map();
      const nodes = entry.graph.nodes;
      const count = nodes.length;

      nodes.forEach((node, j) => {
        let x, y;
        if (count === 1) { x = cx; y = cy; }
        else {
          const angle = (j / count) * Math.PI * 2 - Math.PI / 2;
          x = cx + Math.cos(angle) * radius;
          y = cy + Math.sin(angle) * radius;
        }
        const un = preview.addNode(x, y, node.label);
        localMap.set(node.id, un.id);
        originMap.set(un.id, { sourceIndex: i, sourceNodeId: node.id });
      });

      for (const edge of entry.graph.edges) {
        const from = localMap.get(edge.from);
        const to = localMap.get(edge.to);
        if (from != null && to != null) preview.addEdge(from, to, '');
      }
    });

    this._previewCache = preview;
    this._previewOrigin = originMap;
    return preview;
  }
}