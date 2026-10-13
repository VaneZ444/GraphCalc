import { h } from '../util/dom.js';
import { MODULES } from '../modules/index.js';

export function createTabs(app, host) {
  const buttons = MODULES.map(module =>
    h('button', {
      class: 'tab',
      'data-tab': module.id,
      onclick: () => app.setTab(module.id),
    }, module.label));

  const sync = () => {
    for (const button of buttons) {
      button.classList.toggle('is-active', button.dataset.tab === app.tab);
    }
  };

  app.on('tab', sync);
  sync();

  host.append(...buttons);
  return host;
}