// js/ui/graphController.js

import { h } from '../util/dom.js';
import { CANVAS } from '../config.js';
import { clamp } from '../util/format.js';

/**
 * Wires renderer interaction callbacks to graph mutations.
 * Keeping this separate means the renderer stays completely generic.
 */
export function attachGraphController(app, renderer) {
  renderer.on({
    onNodePointerDown(nodeId, point, event) {
      // Shift-click sets the start node regardless of the active tool.
      if (event.shiftKey) {
        app.setStartNode(nodeId);
        return false;
      }

      if (app.tool === 'erase') {
        app.graph.removeNode(nodeId);
        app.afterGraphMutation();
        return false;
      }

      if (app.tool === 'edge') {
        if (app.pendingFrom === null) {
          app.pendingFrom = nodeId;
        } else {
          if (app.pendingFrom !== nodeId) {
            const created = app.graph.addEdge(app.pendingFrom, nodeId);
            if (created) app.selection = { kind: 'edge', id: created.id };
          }
          app.pendingFrom = null;
        }
        app.emit('selection', app.selection);
        app.recompute();
        return false;
      }

      app.selection = { kind: 'node', id: nodeId };
      app.emit('selection', app.selection);
      app.recompute();
      return true; // allow dragging
    },

    onEdgePointerDown(edgeId) {
      if (app.tool === 'erase') {
        app.graph.removeEdge(edgeId);
        app.afterGraphMutation();
        return;
      }
      app.selection = { kind: 'edge', id: edgeId };
      app.emit('selection', app.selection);
      app.recompute();
    },

    onBackgroundPointerDown(point) {
      if (app.tool === 'node') {
        const node = app.graph.addNode(
          clamp(point.x, CANVAS.margin / 2, CANVAS.width - CANVAS.margin / 2),
          clamp(point.y, CANVAS.margin / 2, CANVAS.height - CANVAS.margin / 2),
        );
        app.selection = { kind: 'node', id: node.id };
        app.emit('selection', app.selection);
        app.recompute();
        return;
      }

      if (app.selection) {
        app.selection = null;
        app.emit('selection', null);
        app.recompute();
      }
    },

    onBackgroundDoubleClick(point) {
      if (app.tool !== 'select') return;
      const node = app.graph.addNode(
        clamp(point.x, CANVAS.margin / 2, CANVAS.width - CANVAS.margin / 2),
        clamp(point.y, CANVAS.margin / 2, CANVAS.height - CANVAS.margin / 2),
      );
      app.selection = { kind: 'node', id: node.id };
      app.emit('selection', app.selection);
      app.recompute();
    },

    onNodeMove(nodeId, point) {
      const node = app.graph.node(nodeId);
      if (!node) return;
      node.x = Math.round(clamp(point.x, 26, CANVAS.width - 26));
      node.y = Math.round(clamp(point.y, 26, CANVAS.height - 26));
      app.recompute();
    },
  });

  window.addEventListener('keydown', event => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if ((event.key === 'Delete' || event.key === 'Backspace') && app.selection) {
      event.preventDefault();
      if (app.selection.kind === 'node') app.graph.removeNode(app.selection.id);
      else app.graph.removeEdge(app.selection.id);
      app.selection = null;
      app.emit('selection', null);
      app.afterGraphMutation();
    }

    if (event.key === 'Escape') {
      app.pendingFrom = null;
      app.selection = null;
      app.emit('selection', null);
      app.recompute();
    }

    if (event.key === ' ') {
      event.preventDefault();
      app.togglePlay();
    }
  });
}