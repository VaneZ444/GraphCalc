// js/ui/graphController.js
//
// Mutations target either a source graph (when editing one) or the merged
// graph. Positions are no longer clamped to the initial canvas — the graph
// space is unbounded, and the renderer's fit-to-content handles the framing.
// Pan/zoom live entirely in svgRenderer and bypass these handlers.

import { CANVAS } from '../config.js';

export function attachGraphController(app, renderer) {
  const editable = () => app.isEditingSource || app.isFormulated;

  const afterMutation = () => {
    if (app.isEditingSource) app.afterSourceMutation();
    else app.afterGraphMutation();
  };

  renderer.on({
    onNodePointerDown(nodeId, point, event) {
      // Preview grid: clicking a preview node jumps into that source's editor.
      if (!editable() && !app.isFormulated) {
        const origin = app._previewOrigin?.get(nodeId);
        if (origin) app.editSource(origin.sourceIndex);
        return false;
      }
      if (!editable()) return false;

      if (event.shiftKey && !app.isEditingSource) {
        app.setStartNode(nodeId);
        return false;
      }

      if (app.tool === 'erase') {
        app.graph.removeNode(nodeId);
        afterMutation();
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
        afterMutation();
        return false;
      }

      app.selection = { kind: 'node', id: nodeId };
      app.emit('selection', app.selection);
      app.recompute();
      return true;
    },

    onEdgePointerDown(edgeId) {
      if (!editable()) return;
      if (app.tool === 'erase') {
        app.graph.removeEdge(edgeId);
        afterMutation();
        return;
      }
      app.selection = { kind: 'edge', id: edgeId };
      app.emit('selection', app.selection);
      app.recompute();
    },

    onBackgroundPointerDown(point) {
      // Add node on the empty canvas always targets a source graph.
      if (app.tool === 'node' && !app.isEditingSource) {
        app.addSource({ x: point.x, y: point.y });
        return;
      }
      if (!editable()) return;

      if (app.tool === 'node') {
        const node = app.graph.addNode(point.x, point.y);
        app.selection = { kind: 'node', id: node.id };
        app.emit('selection', app.selection);
        afterMutation();
        return;
      }

      if (app.selection) {
        app.selection = null;
        app.emit('selection', null);
        app.recompute();
      }
    },

    onBackgroundDoubleClick(point) {
      if (!editable()) return;
      if (app.tool !== 'select') return;

      const node = app.graph.addNode(point.x, point.y);
      app.selection = { kind: 'node', id: node.id };
      app.emit('selection', app.selection);
      afterMutation();
    },

    onNodeMove(nodeId, point) {
      if (!editable()) return;
      const node = app.graph.node(nodeId);
      if (!node) return;

      node.x = Math.round(point.x);
      node.y = Math.round(point.y);

      if (app.isEditingSource) {
        // Position-only change — invalidate the cached preview grid so the
        // node shows at its new position when we leave source-edit mode.
        app.invalidatePreview();
        app.emit('change');
      } else {
        app.recompute();
      }
    },
  });

  window.addEventListener('keydown', event => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if ((event.key === 'Delete' || event.key === 'Backspace') && editable() && app.selection) {
      event.preventDefault();
      if (app.selection.kind === 'node') app.graph.removeNode(app.selection.id);
      else app.graph.removeEdge(app.selection.id);
      app.selection = null;
      app.emit('selection', null);
      afterMutation();
      return;
    }

    if (event.key === 'Escape') {
      if (!editable()) return;
      app.pendingFrom = null;
      app.selection = null;
      app.emit('selection', null);
      app.recompute();
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      app.togglePlay();
    }
  });
}