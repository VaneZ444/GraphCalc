// js/core/graphSet.js
//
// A GraphSet holds N independent source graphs. Two nodes across different
// source graphs are considered "the same" if they share a label (name).
// formulate() merges them by label and splits the result into connected
// components. combineComponents() then lays those components out on the canvas
// and produces a single working Graph for the algorithm modules.

import { Graph } from './graph.js';

export class GraphSet {
  constructor() {
    this.graphs = []; // { id, name, graph }
    this._seq = 1;
  }

  get size() { return this.graphs.length; }
  
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
  
  add(graph, name) {
    const entry = {
      id: `g${this._seq++}`,
      name: name || `Graph ${this.graphs.length + 1}`,
      graph,
    };
    this.graphs.push(entry);
    return entry;
  }

  remove(id) {
    this.graphs = this.graphs.filter(g => g.id !== id);
  }

  clear() {
    this.graphs = [];
    this._seq = 1;
  }

  /**
   * Merge every graph by shared node labels, then split into connected
   * components.
   *
   * Returns Array<{ id: string, graph: Graph, names: string[] }>.
   *   - components are name-disjoint by construction, so node labels stay
   *     unique across the whole set.
   *   - if the same link (by label pair) exists in two source graphs with
   *     different conditions, only the first condition is kept.
   */
  buildGraphAtStep(stepIndex) {
    if (!this._stepCache) this._stepCache = new Map();
    if (this._stepCache.has(stepIndex)) return this._stepCache.get(stepIndex);

    const N = this.getTotalSteps();
    const { preview, origin, byLabel, sharedLabels } = this._formulation;
    const appliedLabels = new Set(sharedLabels.slice(0, stepIndex));

    // --- 1. Топология: сгруппировать preview-вершины по merge-классам ---
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
      const firstPvId = members[0];
      const o = origin.get(firstPvId);
      const srcGraph = this.graphSet.graphs[o.sourceIndex]?.graph;
      const srcNode = srcGraph?.node(o.sourceNodeId);
      const label = srcNode?.label ?? '?';

      const newNode = graph.addNode(0, 0, label);
      keyToNodeId.set(key, newNode.id);
      nodeSources.set(newNode.id, members.length === 1 ? o : null);
    }

    // --- 2. Рёбра из всех исходных графов ---
    const reverseOrigin = new Map();
    for (const [pvId, o] of origin) {
      reverseOrigin.set(`${o.sourceIndex}:${o.sourceNodeId}`, pvId);
    }

    const seenEdges = new Set();
    for (let si = 0; si < this.graphSet.graphs.length; si++) {
      const entry = this.graphSet.graphs[si];
      for (const edge of entry.graph.edges) {
        const fromPv = reverseOrigin.get(`${si}:${edge.from}`);
        const toPv   = reverseOrigin.get(`${si}:${edge.to}`);
        if (fromPv == null || toPv == null) continue;

        const fromKey = classKey.get(fromPv);
        const toKey   = classKey.get(toPv);
        if (fromKey === toKey) continue;

        const edgeKey = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        const fromId = keyToNodeId.get(fromKey);
        const toId   = keyToNodeId.get(toKey);
        if (fromId && toId) graph.addEdge(fromId, toId, edge.condition);
      }
    }

    // --- 3. Анкеры: позиция ПЕРВОГО (по индексу источника) экземпляра ---
    //
    // Именно тут мы уходим от «центроид собирает всё в центр». Каждая вершина
    // привязана к одному конкретному месту из preview — туда, где живёт её
    // «главный» экземпляр. Остальные экземпляры (из других графов) подтянутся
    // к ней через силу рёбер, но анкер тянет обратно → перекос в центр исчезает.
    const anchors = new Map();
    for (const node of graph.nodes) {
      const instances = byLabel.get(node.label) || [];
      let chosenPvId = null;
      let chosenSourceIndex = Infinity;

      for (const pvId of instances) {
        const o = origin.get(pvId);
        if (!o) continue;
        if (o.sourceIndex < chosenSourceIndex) {
          chosenSourceIndex = o.sourceIndex;
          chosenPvId = pvId;
        }
      }

      if (chosenPvId !== null) {
        const pvNode = preview.node(chosenPvId);
        if (pvNode) anchors.set(node.id, { x: pvNode.x, y: pvNode.y });
      }
    }

    // Стартуем из анкеров
    for (const node of graph.nodes) {
      const a = anchors.get(node.id);
      if (a) { node.x = a.x; node.y = a.y; }
    }

    // --- 4. Force-directed ---
    //
    // step 0  → всё уже на своих местах (preview), не запускаем.
    // step k  → homeStrength плавно падает с 1 до 0.05, кусочки постепенно
    //           подтягиваются друг к другу, но анкеры не дают им «слипнуться».
    // step N  → homeStrength = 0.05, максимальное стягивание, но отталкивание
    //           разводит перекрытия.
    if (stepIndex > 0 && N > 0) {
      const homeStrength = 1 - (stepIndex / N) * 0.95;
      forceDirectedLayout(graph, anchors, { homeStrength });
      fitToCanvas(graph, CANVAS);
    }

    const result = { graph, nodeSources };
    this._stepCache.set(stepIndex, result);
    return result;
  }
  formulate() {
    // 1. Index every label across every source graph.
    const occurrences = new Map(); // label -> [{ graphId, node }]
    for (const entry of this.graphs) {
      for (const node of entry.graph.nodes) {
        const key = node.label;
        if (!occurrences.has(key)) occurrences.set(key, []);
        occurrences.get(key).push({ graphId: entry.id, node });
      }
    }

    // 2. Flatten edges to label pairs.
    const edgesByLabel = [];
    for (const entry of this.graphs) {
      for (const edge of entry.graph.edges) {
        const from = entry.graph.node(edge.from);
        const to = entry.graph.node(edge.to);
        if (!from || !to) continue;
        edgesByLabel.push({
          fromLabel: from.label,
          toLabel: to.label,
          condition: edge.condition || '',
        });
      }
    }

    // 3. Union-find over labels (implemented as BFS on an adjacency map).
    const adjacency = new Map();
    for (const label of occurrences.keys()) adjacency.set(label, new Set());

    for (const e of edgesByLabel) {
      if (!adjacency.has(e.fromLabel) || !adjacency.has(e.toLabel)) continue;
      adjacency.get(e.fromLabel).add(e.toLabel);
      adjacency.get(e.toLabel).add(e.fromLabel);
    }

    const components = [];
    const visited = new Set();

    for (const label of occurrences.keys()) {
      if (visited.has(label)) continue;

      const names = new Set();
      const queue = [label];

      while (queue.length) {
        const cur = queue.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);
        names.add(cur);

        for (const next of adjacency.get(cur) || []) {
          if (!visited.has(next)) queue.push(next);
        }
      }
      components.push(names);
    }

    // 4. Materialize one Graph per component.
    return components.map((labelSet, index) => {
      const graph = new Graph();
      const labelToId = new Map();

      for (const label of labelSet) {
        const occ = occurrences.get(label) || [];
        let x = 0, y = 0;
        for (const o of occ) { x += o.node.x; y += o.node.y; }
        x /= occ.length || 1;
        y /= occ.length || 1;

        const node = graph.addNode(x, y, label);
        labelToId.set(label, node.id);
      }

      for (const e of edgesByLabel) {
        if (!labelSet.has(e.fromLabel) || !labelSet.has(e.toLabel)) continue;
        const fromId = labelToId.get(e.fromLabel);
        const toId = labelToId.get(e.toLabel);
        if (fromId == null || toId == null) continue;
        graph.addEdge(fromId, toId, e.condition);   // Graph dedupes internally
      }

      return { id: `comp-${index + 1}`, graph, names: [...labelSet] };
    });
  }
}

/**
 * Lay the formulated components out on the canvas and combine them into one
 * Graph for the algorithm modules. Since components are label-disjoint, their
 * nodes' labels remain unique — no id namespacing is needed.
 */
export function combineComponents(components, canvas) {
  const unified = new Graph();
  if (!components.length) return unified;

  const cols = Math.ceil(Math.sqrt(components.length));
  const rows = Math.ceil(components.length / cols);
  const cellW = canvas.width / cols;
  const cellH = canvas.height / rows;
  const pad = 42;

  components.forEach((comp, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * cellW + cellW / 2;
    const cy = row * cellH + cellH / 2;
    const radius = Math.min(cellW, cellH) / 2 - pad;

    const localToUnified = new Map();
    const nodes = comp.graph.nodes;
    const count = nodes.length;

    nodes.forEach((node, j) => {
      let x, y;
      if (count === 1) {
        x = cx; y = cy;
      } else {
        const angle = (j / count) * Math.PI * 2 - Math.PI / 2;
        x = cx + Math.cos(angle) * radius;
        y = cy + Math.sin(angle) * radius;
      }
      const un = unified.addNode(x, y, node.label);
      localToUnified.set(node.id, un.id);
    });

    for (const edge of comp.graph.edges) {
      const from = localToUnified.get(edge.from);
      const to = localToUnified.get(edge.to);
      if (from != null && to != null) unified.addEdge(from, to, edge.condition);
    }
  });

  return unified;
}   
