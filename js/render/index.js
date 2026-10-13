import { SVGRenderer } from './svgRenderer.js';

/**
 * Renderer registry — swap implementations without touching the app.
 */
export const RENDERERS = {
  svg: SVGRenderer,
};

export function createRenderer(name = 'svg', handlers = {}) {
  const RendererClass = RENDERERS[name];
  if (!RendererClass) throw new Error(`Unknown renderer "${name}"`);

  const renderer = new RendererClass();
  renderer.on(handlers);
  return renderer;
}