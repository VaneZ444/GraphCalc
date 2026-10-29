// js/ui/graphController.js
//
// All graph mutations flow through here. Mutations target either a source
// graph (when the user is editing one) or the merged graph. Source mutations
// re-run formulation so the merged view stays live.

import { CANVAS } from '../config.js';
import { clamp } from '../util/format.js';

export function attachGraphController(app, renderer) {
  const editable = () => {
    if (app.isEditingSource) return true;
    return app.isFormulated;
  };

  const afterMutation = () => {
    if (app.isEditingSource) app.afterSourceMutation();
    else app.afterGraphMutation();
  };

  renderer.on({
    /* ---------------------------------------------------------------- nodes */

    onNodePointerDown(nodeId, point, event) {
      // Preview mode (t < 1, no source selected): clicking a preview node
      // jumps into that source graph's editor.
      if (!editable() && !app.isEditingSource && !app.isFormulated) {
        const origin = app._previewOrigin?.get(nodeId);
        if (origin) app.editSource(origin.sourceIndex);
        return false;
      }

      if (!editable()) return false;

      // Shift-click to set start node — only meaningful for the merged graph.
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

    /* ---------------------------------------------------------------- edges */

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

    /* ----------------------------------------------------------- background */

        onBackgroundPointerDown(point) {
      // "Add node" on the empty canvas always targets a *source* graph.
      //
      //   – already editing a source  → the normal path below adds to it
      //   – not editing a source      → spin up a new source that contains
      //                                 just this node, and enter its editor
      //
      // This makes manual graph construction work at any t, including the
      // pre-formulation window (t < 1) where the canvas shows the preview
      // grid and nothing is otherwise editable.
      if (app.tool === 'node' && !app.isEditingSource) {
        app.addSource({
          x: clamp(point.x, CANVAS.margin / 2, CANVAS.width - CANVAS.margin / 2),
          y: clamp(point.y, CANVAS.margin / 2, CANVAS.height - CANVAS.margin / 2),
        });
        return;
      }

      if (!editable()) return;

      if (app.tool === 'node') {
        const node = app.graph.addNode(
          clamp(point.x, CANVAS.margin / 2, CANVAS.width - CANVAS.margin / 2),
          clamp(point.y, CANVAS.margin / 2, CANVAS.height - CANVAS.margin / 2),
        );
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

      const node = app.graph.addNode(
        clamp(point.x, CANVAS.margin / 2, CANVAS.width - CANVAS.margin / 2),
        clamp(point.y, CANVAS.margin / 2, CANVAS.height - CANVAS.margin / 2),
      );
      app.selection = { kind: 'node', id: node.id };
      app.emit('selection', app.selection);
      afterMutation();
    },

    /* ------------------------------------------------------------- dragging */

    onNodeMove(nodeId, point) {
      if (!editable()) return;

      const node = app.graph.node(nodeId);
      if (!node) return;

      node.x = Math.round(clamp(point.x, 26, CANVAS.width - 26));
      node.y = Math.round(clamp(point.y, 26, CANVAS.height - 26));

      if (app.isEditingSource) {
        // Position-only change on a source: invalidate the preview grid so
        // it re-lays the dragged node next time we leave source-edit mode.
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