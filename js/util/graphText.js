// js/util/graphText.js
//
// Bidirectional conversion between a source Graph and a compact text form.
//
// Format (one entry per line, or comma-separated):
//   A               isolated node
//   A-B             edge between A and B
//   A-B: t > 1      edge with a condition

import { Graph } from '../core/graph.js';
import { CANVAS } from '../config.js';

const ENTRY_RE = /^([A-Za-z0-9_]+)\s*(?:-\s*([A-Za-z0-9_]+))?\s*(?::\s*(.+))?$/;

export function graphToText(graph) {
  const lines = [];
  const touched = new Set();

  for (const edge of graph.edges) {
    const from = graph.node(edge.from);
    const to   = graph.node(edge.to);
    if (!from || !to) continue;

    const cond = (edge.condition || '').trim();
    lines.push(cond ? `${from.label}-${to.label}: ${cond}` : `${from.label}-${to.label}`);
    touched.add(from.id);
    touched.add(to.id);
  }

  for (const node of graph.nodes) {
    if (!touched.has(node.id)) lines.push(node.label);
  }

  return lines.join('\n');
}

/**
 * @param {string} text
 * @param {object} [options]
 * @param {Map<string,{x:number,y:number}>} [options.preservePositions]
 *        label → position, used to keep node coordinates stable when editing.
 */
export function textToGraph(text, options = {}) {
  const { preservePositions = null } = options;

  const graph = new Graph();
  const labelToNode = new Map();
  const placed = new Set();

  const ensureNode = label => {
    if (labelToNode.has(label)) return labelToNode.get(label);

    let x = null, y = null;
    if (preservePositions && preservePositions.has(label)) {
      const p = preservePositions.get(label);
      x = p.x; y = p.y;
    }

    const node = graph.addNode(x ?? 0, y ?? 0, label);
    labelToNode.set(label, node);
    if (x !== null) placed.add(label);
    return node;
  };

  const entries = text.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);

  for (const entry of entries) {
    const match = entry.match(ENTRY_RE);
    if (!match) continue;

    const [, fromLabel, toLabel, cond] = match;
    if (!fromLabel) continue;

    const from = ensureNode(fromLabel);
    if (toLabel) {
      const to = ensureNode(toLabel);
      graph.addEdge(from.id, to.id, (cond || '').trim());
    }
  }

  layoutUnplaced(graph, placed);
  return graph;
}

/* --------------------------------------------------------------- helpers */

function layoutUnplaced(graph, placed) {
  const unplaced = graph.nodes.filter(n => !placed.has(n.label));
  if (unplaced.length === 0) return;

  const cx0 = CANVAS.width / 2;
  const cy0 = CANVAS.height / 2;
  const radius = Math.min(CANVAS.width, CANVAS.height) * 0.35;

  if (placed.size === 0) {
    // Nothing is anchored — lay the whole graph out in a circle.
    graph.nodes.forEach((n, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2 - Math.PI / 2;
      n.x = Math.round(cx0 + Math.cos(angle) * radius);
      n.y = Math.round(cy0 + Math.sin(angle) * radius);
    });
    return;
  }

  // Some nodes anchored — place the rest on a ring around their centroid.
  let cx = 0, cy = 0, count = 0;
  for (const n of graph.nodes) {
    if (!placed.has(n.label)) continue;
    cx += n.x; cy += n.y; count++;
  }
  cx /= count; cy /= count;

  unplaced.forEach((n, i) => {
    const angle = (i / unplaced.length) * Math.PI * 2;
    const r = 90 + i * 22;
    n.x = Math.round(cx + Math.cos(angle) * r);
    n.y = Math.round(cy + Math.sin(angle) * r);
  });
}