// js/modules/index.js

import { traversalModule } from './traversal.js';
import { antifraudModule } from './antifraud.js';
import { infectionModule } from './infection.js';

/**
 * Module contract
 * ───────────────
 *   id             unique key, also used as the tab id
 *   label          tab label
 *   defaults       initial state object (cloned per app instance)
 *   buildControls(ctx) -> HTMLElement      sidebar controls (built on tab switch)
 *   run(ctx)       -> result               pure computation, called on every change
 *   renderOutput(result, ctx) -> Element   output panel body
 *
 * `run` result shape:
 *   {
 *     nodes:  Map<nodeId, string[]>,   // extra CSS tokens, e.g. ['is-visited']
 *     edges:  Map<edgeId, string[]>,   // e.g. ['is-tree']
 *     summary: [{ label, value }],
 *     output: any                      // module-specific payload
 *   }
 *
 * Because every module produces the same view-model shape, the renderer never
 * needs to know which algorithm is running — this is the "universal render".
 */
export const MODULES = [traversalModule, antifraudModule, infectionModule];

const BY_ID = new Map(MODULES.map(m => [m.id, m]));

export function getModule(id) {
  return BY_ID.get(id) || MODULES[0];
}