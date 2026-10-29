// js/ui/timeline.js

import { h } from '../util/dom.js';
import { TIMELINE, FORMULATION_T } from '../config.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export function createTimeline(app, host) {
  const fill = h('div', { class: 'tl-fill' });
  const head = h('div', { class: 'tl-head' });

  const mergePercent =
    ((FORMULATION_T - TIMELINE.min) / (TIMELINE.max - TIMELINE.min)) * 100;

  const phaseZone = h('div', {
    class: 'tl-phase-zone',
    style: { width: `${mergePercent}%` },
    title: 'Formulation phase — merges happen here, step by step',
  });

  const phaseMark = h('div', {
    class: 'tl-phase-mark',
    style: { left: `${mergePercent}%` },
    title: 'Formulation completes here (t = 0)',
  });

  const track = h('div', { class: 'tl-track' },
    phaseZone, fill, phaseMark, head);

  const playButton    = h('button', { class: 'tl-btn tl-play', title: 'Play / Pause' }, '▶');
  const startButton   = h('button', { class: 'tl-btn', title: 'Jump to start' }, '⏮');
  const backButton    = h('button', { class: 'tl-btn', title: 'Previous step' }, '⏪');
  const forwardButton = h('button', { class: 'tl-btn', title: 'Next step' }, '⏩');
  const endButton     = h('button', { class: 'tl-btn', title: 'Jump to end' }, '⏭');
  const loopButton    = h('button', { class: 'tl-btn', title: 'Loop' }, '↻');

  const timeReadout = h('span', { class: 'tl-time' }, '0.00');
  const maxReadout  = h('span', {}, TIMELINE.max.toFixed(2));

  const speedSelect = h('select', { class: 'tl-speed', title: 'Playback speed' },
    ...SPEEDS.map(speed =>
      h('option', { value: speed, selected: speed === app.speed }, `${speed}×`)));

  playButton.addEventListener('click', () => app.togglePlay());
  startButton.addEventListener('click', () => app.seekStart());
  endButton.addEventListener('click', () => app.seekEnd());
  backButton.addEventListener('click', () => app.stepBy(-1));
  forwardButton.addEventListener('click', () => app.stepBy(1));
  loopButton.addEventListener('click', () => app.setLoop(!app.loop));

  speedSelect.addEventListener('change', event => {
    app.setSpeed(parseFloat(event.target.value));
  });

  let seeking = false;

  const seekFromEvent = event => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    app.setTime(TIMELINE.min + ratio * (TIMELINE.max - TIMELINE.min));
  };

  track.addEventListener('pointerdown', event => {
    seeking = true;
    track.setPointerCapture(event.pointerId);
    app.pause();
    seekFromEvent(event);
  });

  track.addEventListener('pointermove', event => {
    if (seeking) seekFromEvent(event);
  });

  const stopSeeking = () => { seeking = false; };
  track.addEventListener('pointerup', stopSeeking);
  track.addEventListener('pointercancel', stopSeeking);

  function sync() {
    const ratio = app.progress;
    fill.style.width = `${(ratio * 100).toFixed(2)}%`;
    head.style.left = `${(ratio * 100).toFixed(2)}%`;
    timeReadout.textContent = app.t.toFixed(2);

    playButton.textContent = app.playing ? '❚❚' : '▶';
    playButton.classList.toggle('is-active', app.playing);
    loopButton.classList.toggle('is-active', app.loop);
    speedSelect.value = String(app.speed);

    phaseMark.classList.toggle('is-passed', app.t >= FORMULATION_T);
  }

  app.on('change', sync);
  app.on('transport', sync);
  sync();

  host.append(
    h('div', { class: 'tl-controls' },
      startButton, backButton, playButton, forwardButton, endButton),
    track,
    h('div', { class: 'tl-readout' }, timeReadout, ' / ', maxReadout),
    speedSelect,
    loopButton,
  );
}