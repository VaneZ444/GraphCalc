// js/core/app.js

import { Emitter } from './emitter.js';
import { Graph } from './graph.js';
import { GraphSet, combineComponents } from './graphSet.js';
import { evaluateEdges } from './analysis.js';
import { MODULES, getModule } from '../modules/index.js';
import { TIMELINE, CANVAS, FORMULATION_T } from '../config.js';
import { clamp } from '../util/format.js';

export class App extends Emitter {
  constructor() {
    super();

    this.graphSet = new GraphSet();
    this.components = [];
    this.unifiedGraph = new Graph();

    this._previewCache = null;
    this._previewOrigin = null;
    this._formulation = null;
    this._stepCache = null;
    this._renderedSources = null;

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

  getEditGraph() {
    if (this.editingSourceIndex !== null) {
      return this.graphSet.graphs[this.editingSourceIndex]?.graph || null;
    }
    return this.unifiedGraph;
  }

  get graph() { return this.getEditGraph() || this.unifiedGraph; }

  get isFormulated() { return this.t >= FORMULATION_T; }
  get isEditingSource() { return this.editingSourceIndex !== null; }

  get currentEdgeStates() {
    if (this.editingSourceIndex === null) return this.edgeStates;
    const g = this.getEditGraph();
    if (!g) return new Map();
    return evaluateEdges(g, this.t);
  }

  /* ---------------------------------------------------- formulation steps */

  getTotalSteps() {
    return this._formulation?.sharedLabels?.length ?? 0;
  }

  stepForTime(t) {
    const N = this.getTotalSteps();
    if (t >= FORMULATION_T) return N;
    if (N === 0) return 0;
    if (t <= TIMELINE.min) return 0;
    const span = -TIMELINE.min;
    const progress = (t - TIMELINE.min) / span;
    return Math.min(N - 1, Math.floor(progress * N));
  }

  computeFormulationSteps() {
    const preview = this.sourcePreviewGraph();
    const origin = this._previewOrigin;

    const byLabel = new Map();
    for (const node of preview.nodes) {
      const o = origin.get(node.id);
      if (!o) continue;
      const srcGraph = this.graphSet.graphs[o.sourceIndex]?.graph;
      const srcNode = srcGraph?.node(o.sourceNodeId);
      if (!srcNode) continue;
      const label = srcNode.label;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(node.id);
    }

    const sharedLabels = [...byLabel.entries()]
      .filter(([, ids]) => ids.length >= 2)
      .map(([label]) => label)
      .sort();

    return { preview, origin, byLabel, sharedLabels };
  }

  /**
   * Build the graph for formulation step `stepIndex`.
   *
   *   step < N   → centroid-based merge: nodes that share an already-applied
   *                label collapse to the centroid of their source instances.
   *                This makes the progressive "merge" visible.
   *
   *   step >= N  → the final, properly-laid-out merged graph produced by
   *                combineComponents(). Components are spread across the
   *                canvas in a grid; nodes within a component are laid out
   *                in a circle inside that cell. This is what fixes the
   *                "everything piles up in the middle" problem.
   */
  buildGraphAtStep(stepIndex) {
    if (!this._stepCache) this._stepCache = new Map();
    if (this._stepCache.has(stepIndex)) return this._stepCache.get(stepIndex);

    const N = this.getTotalSteps();

    // Final state — hand off to the nice component-grid layout.
    if (N > 0 && stepIndex >= N) {
      const result = { graph: this.unifiedGraph, nodeSources: new Map() };
      this._stepCache.set(stepIndex, result);
      return result;
    }

    // Intermediate states — centroid-based merge.
    const { preview, origin, sharedLabels } = this._formulation;
    const appliedLabels = new Set(sharedLabels.slice(0, stepIndex));

    const classKey = new Map();
    const classMembers = new Map();

    for (const pvNode of preview.nodes) {
      const o = origin.get(pvNode.id);
      if (!o) continue;
      const srcGraph = this.graphSet.graphs[o.sourceIndex]?.graph;
      const srcNode = srcGraph?.node(o.sourceNodeId);
      if (!srcNode) continue;

      const label = srcNode.label;
      const key = appliedLabels.has(label) ? `L:${label}` : `I:${pvNode.id}`;

      classKey.set(pvNode.id, key);
      if (!classMembers.has(key)) classMembers.set(key, []);
      classMembers.get(key).push(pvNode.id);
    }

    const graph = new Graph();
    const keyToNodeId = new Map();
    const nodeSources = new Map();

    for (const [key, members] of classMembers) {
      let cx = 0, cy = 0;
      for (const pvId of members) {
        const pn = preview.node(pvId);
        cx += pn.x;
        cy += pn.y;
      }
      cx /= members.length;
      cy /= members.length;

      const firstPvId = members[0];
      const o = origin.get(firstPvId);
      const srcGraph = this.graphSet.graphs[o.sourceIndex]?.graph;
      const srcNode = srcGraph?.node(o.sourceNodeId);
      const label = srcNode?.label ?? '?';

      const newNode = graph.addNode(cx, cy, label);
      keyToNodeId.set(key, newNode.id);
      nodeSources.set(newNode.id, members.length === 1 ? o : null);
    }

    const reverseOrigin = new Map();
    for (const [pvId, o] of origin) {
      reverseOrigin.set(`${o.sourceIndex}:${o.sourceNodeId}`, pvId);
    }

    const seenEdges = new Set();
    for (let si = 0; si < this.graphSet.graphs.length; si++) {
      const entry = this.graphSet.graphs[si];
      for (const edge of entry.graph.edges) {
        const fromPv = reverseOrigin.get(`${si}:${edge.from}`);
        const toPv = reverseOrigin.get(`${si}:${edge.to}`);
        if (fromPv == null || toPv == null) continue;

        const fromKey = classKey.get(fromPv);
        const toKey = classKey.get(toPv);
        if (fromKey === toKey) continue;

        const edgeKey = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        const fromId = keyToNodeId.get(fromKey);
        const toId = keyToNodeId.get(toKey);
        if (fromId && toId) graph.addEdge(fromId, toId, edge.condition);
      }
    }

    const result = { graph, nodeSources };
    this._stepCache.set(stepIndex, result);
    return result;
  }

  /* --------------------------------------------------------- graph set */

  setGraphSet(set) {
    this.graphSet = set;
    this.editingSourceIndex = null;
    this.formulate();
  }

  invalidatePreview() {
    this._previewCache = null;
    this._previewOrigin = null;
  }

  formulate({ preserveSelection = false } = {}) {
    this.components = this.graphSet.formulate();

    this.invalidatePreview();
    this._stepCache = new Map();

    this._formulation = this.computeFormulationSteps();

    // Final layout — combineComponents spreads each connected component
    // into its own grid cell and lays that component's nodes in a circle
    // inside the cell. Without this, the final merged graph would be a
    // pile of centroids in the middle of the canvas.
    this.unifiedGraph = combineComponents(this.components, CANVAS);

    this.startNodeId = null;

    if (!preserveSelection) {
      this.selection = null;
      this.pendingFrom = null;
      this.emit('selection', null);
    }

    this.validateReferences();
    this.recompute();
  }

  afterSourceMutation() {
    this.formulate({ preserveSelection: true });
  }

  clearAll() {
    this.graphSet.clear();
    this.components = [];
    this.unifiedGraph = new Graph();
    this.invalidatePreview();
    this._formulation = null;
    this._stepCache = null;
    this._renderedSources = null;
    this.editingSourceIndex = null;
    this.selection = null;
    this.startNodeId = null;
    this.pendingFrom = null;
    this.emit('selection', null);
    this.recompute();
  }

  /* --------------------------------------------------- source editing */

  editSource(index) {
    if (index !== null && (index < 0 || index >= this.graphSet.size)) index = null;
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

  replaceSourceGraph(index, newGraph) {
    const entry = this.graphSet.graphs[index];
    if (!entry) return;
    entry.graph = newGraph;
    this.selection = null;
    this.pendingFrom = null;
    this.formulate();
  }

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

    const wasBelow = this.t < FORMULATION_T;
    this.t = next;

    if (wasBelow && next >= FORMULATION_T && this.editingSourceIndex !== null) {
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

  stepBy(d) {
    this.pause();
    let stepSize = TIMELINE.step;
    if (this.t < FORMULATION_T) {
      const N = this.getTotalSteps();
      if (N > 0) stepSize = -TIMELINE.min / N;
    }
    this.setTime(this.t + d * stepSize);
  }

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

    const wasBelow = this.t < FORMULATION_T;
    this.t = next;

    if (wasBelow && next >= FORMULATION_T && this.editingSourceIndex !== null) {
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
    if (this.editingSourceIndex !== null) return;
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
      graph: this.unifiedGraph,
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
    // 1) Source editor
    if (this.editingSourceIndex !== null) {
      const sourceGraph = this.getEditGraph();
      if (sourceGraph) {
        const states = evaluateEdges(sourceGraph, this.t);
        this._renderedSources = null;
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

    // 2) Formulation phase — step-by-step merge.
    if (this.t < FORMULATION_T) {
      const step = this.stepForTime(this.t);
      const { graph, nodeSources } = this.buildGraphAtStep(step);
      this._renderedSources = nodeSources;

      const view = { nodes: new Map(), edges: new Map() };
      if (step > 0) {
        const justMerged = this._formulation.sharedLabels[step - 1];
        for (const node of graph.nodes) {
          if (node.label === justMerged) view.nodes.set(node.id, ['is-just-merged']);
        }
      }

      return {
        graph,
        edgeStates: new Map(),
        view,
        tool: 'select',
        t: this.t,
        phase: 'formulating',
        step,
      };
    }

    // 3) Merged view — algorithms run on the fully laid-out graph.
    this._renderedSources = null;
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