// js/core/graph.js

export class Graph {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this._nodeSeq = 1;
    this._edgeSeq = 1;
  }

  get isEmpty() {
    return this.nodes.length === 0;
  }

  node(id) {
    return this.nodes.find(n => n.id === id) || null;
  }

  edge(id) {
    return this.edges.find(e => e.id === id) || null;
  }

  neighbours(id) {
    return this.edges
      .filter(e => e.from === id || e.to === id)
      .map(e => (e.from === id ? e.to : e.from));
  }

  nextLabel() {
    const used = new Set(this.nodes.map(n => n.label));
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (!used.has(letter)) return letter;
    }
    let index = this.nodes.length + 1;
    while (used.has(`N${index}`)) index++;
    return `N${index}`;
  }

  addNode(x, y, label) {
    const node = {
      id: this._nodeSeq++,
      x: Math.round(x),
      y: Math.round(y),
      label: label || this.nextLabel(),
    };
    this.nodes.push(node);
    return node;
  }

  addEdge(from, to, condition = '') {
    if (from === to) return null;
    const duplicate = this.edges.some(
      e => (e.from === from && e.to === to) || (e.from === to && e.to === from)
    );
    if (duplicate) return null;

    const edge = { id: this._edgeSeq++, from, to, condition };
    this.edges.push(edge);
    return edge;
  }

  removeNode(id) {
    this.nodes = this.nodes.filter(n => n.id !== id);
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
  }

  removeEdge(id) {
    this.edges = this.edges.filter(e => e.id !== id);
  }

  clear() {
    this.nodes = [];
    this.edges = [];
    this._nodeSeq = 1;
    this._edgeSeq = 1;
  }

  toJSON() {
    return { nodes: this.nodes, edges: this.edges };
  }

  static fromJSON(data) {
    const graph = new Graph();
    for (const node of data.nodes || []) graph.nodes.push({ ...node });
    for (const edge of data.edges || []) graph.edges.push({ ...edge });
    graph._nodeSeq = Math.max(0, ...graph.nodes.map(n => n.id)) + 1;
    graph._edgeSeq = Math.max(0, ...graph.edges.map(e => e.id)) + 1;
    return graph;
  }
}