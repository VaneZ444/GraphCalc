// js/core/layout.js
//
// Incremental rigid-body layout + overlap resolution.
//
//   1. ФИКСИРОВАННЫЙ порядок обхода (размер убыв.). Якорь — самый большой.
//   2. Якорь не двигается (трансформ identity).
//   3. Каждый следующий граф получает одну жёсткую Kabsch-трансформацию
//      по общим применённым вершинам с более ранними графами.
//   4. Ноды, которые после трансформа оказались ближе minSeparation,
//      расталкиваются с учётом массы: якорь = ∞, крупные графы тяжёлые,
//      мелкие лёгкие. Мелкий уезжает, крупный почти не двигается.
//   5. Cleanup: ноды тянутся назад к rigid-body позициям, но только
//      если новый position не создаст нового наложения.
//
// Результат: минимальные сдвиги между шагами + никаких скрытых нод.

export function incrementalRigidLayout(graph, ctx) {
  let nodeRadius = ctx.nodeRadius;
  if (typeof nodeRadius !== 'number' || !isFinite(nodeRadius) || nodeRadius <= 0) {
    nodeRadius = 14;
  }

  const { preview, pvBySource, pvToGraphNode, graphSet, appliedLabels } = ctx;

  const N = graphSet.graphs.length;

  // ---------- pvId → origin ----------
  const pvOrigin = new Map();
  for (const [key, pvId] of pvBySource) {
    const parts = key.split(':');
    pvOrigin.set(pvId, {
      sourceIndex: parseInt(parts[0], 10),
      sourceNodeId: parseInt(parts[1], 10),
    });
  }

  // ---------- graph-node → primary preview ----------
  const nodeInfo = new Map();
  for (const [pvId, gNodeId] of pvToGraphNode) {
    const o = pvOrigin.get(pvId);
    if (!o) continue;
    const existing = nodeInfo.get(gNodeId);
    if (!existing || o.sourceIndex < existing.si) {
      nodeInfo.set(gNodeId, { pvId, si: o.sourceIndex });
    }
  }

  // ---------- ФИКСИРОВАННЫЙ порядок ----------
  const order = [];
  for (let si = 0; si < N; si++) {
    if (graphSet.graphs[si].graph.nodes.length > 0) order.push(si);
  }
  order.sort((a, b) => {
    const sa = graphSet.graphs[a].graph.nodes.length;
    const sb = graphSet.graphs[b].graph.nodes.length;
    if (sa !== sb) return sb - sa;
    return a - b;
  });

  const anchorSi = order[0];

  // ---------- Трансформы ----------
  const transforms = {};

  for (const si of order) {
    if (si === anchorSi) {
      transforms[si] = { cos: 1, sin: 0, tx: 0, ty: 0 };
      continue;
    }

    const sg = graphSet.graphs[si].graph;
    const appliedHere = [...new Set(sg.nodes.map(n => n.label))]
      .filter(l => appliedLabels.has(l));

    const pairs = [];
    for (const label of appliedHere) {
      let targetPos = null;
      for (const sj of order) {
        if (sj === si) break;
        const nodeJ = graphSet.graphs[sj].graph.nodes.find(n => n.label === label);
        if (!nodeJ) continue;
        const pvIdJ = pvBySource.get(`${sj}:${nodeJ.id}`);
        if (!pvIdJ) continue;
        const pvJ = preview.node(pvIdJ);
        if (!pvJ) continue;
        const tj = transforms[sj];
        targetPos = {
          x: tj.cos * pvJ.x - tj.sin * pvJ.y + tj.tx,
          y: tj.sin * pvJ.x + tj.cos * pvJ.y + tj.ty,
        };
        break;
      }
      if (!targetPos) continue;

      const localNode = sg.nodes.find(n => n.label === label);
      const pvIdL = pvBySource.get(`${si}:${localNode.id}`);
      if (!pvIdL) continue;
      const pvL = preview.node(pvIdL);
      if (!pvL) continue;

      pairs.push({ lx: pvL.x, ly: pvL.y, tx: targetPos.x, ty: targetPos.y });
    }

    if (pairs.length === 0) {
      transforms[si] = { cos: 1, sin: 0, tx: 0, ty: 0 };
    } else if (pairs.length === 1) {
      const p = pairs[0];
      transforms[si] = { cos: 1, sin: 0, tx: p.tx - p.lx, ty: p.ty - p.ly };
    } else {
      transforms[si] = kabsch(pairs);
    }
  }

  // ---------- Применяем трансформы ----------
    // ---------- Применяем трансформы ----------
  for (const node of graph.nodes) {
    const info = nodeInfo.get(node.id);
    if (!info) continue;
    const pv = preview.node(info.pvId);
    if (!pv) continue;
    const t = transforms[info.si] || { cos: 1, sin: 0, tx: 0, ty: 0 };
    node.x = t.cos * pv.x - t.sin * pv.y + t.tx;
    node.y = t.sin * pv.x + t.cos * pv.y + t.ty;
  }

  // ---------- Проверка NaN: любая нода с NaN откатывается на preview ----------
  let nanCount = 0;
  for (const node of graph.nodes) {
    if (!isFinite(node.x) || !isFinite(node.y)) {
      nanCount++;
      const info = nodeInfo.get(node.id);
      const pv = info ? preview.node(info.pvId) : null;
      if (pv && isFinite(pv.x) && isFinite(pv.y)) {
        node.x = pv.x;
        node.y = pv.y;
      } else {
        // крайний случай — в центр канваса
        node.x = 500;
        node.y = 320;
      }
    }
  }
  if (nanCount > 0) {
    console.warn(`[layout] ${nanCount} node(s) had NaN position after transform — reset to preview`);
  }

  // ---------- Расталкиваем наложения ----------
  const nodeSourceIndex = new Map();
  for (const [gNodeId, info] of nodeInfo) nodeSourceIndex.set(gNodeId, info.si);

  const minSeparation = nodeRadius * 2 + 44;
  resolveOverlaps(graph, nodeSourceIndex, anchorSi, minSeparation);
}

/* ===================================================================== */
/*  Overlap resolution                                                   */
/* ===================================================================== */

function resolveOverlaps(graph, graphOfNode, anchorSi, minNodeSep, nodeRadius) {
  // --- Санитизация входа ---
  if (!isFinite(nodeRadius) || nodeRadius <= 0) nodeRadius = 14;
  if (!isFinite(minNodeSep) || minNodeSep <= 0) minNodeSep = nodeRadius * 2 + 60;

  const n = graph.nodes.length;
  if (n < 2) return;

  // --- Санитизация позиций: если какая-то нода уже NaN, ставим в центр ---
  for (const node of graph.nodes) {
    if (!isFinite(node.x)) node.x = 500;
    if (!isFinite(node.y)) node.y = 320;
  }

  const homeMap = new Map();
  for (const node of graph.nodes) {
    homeMap.set(node.id, { x: node.x, y: node.y });
  }

  const sizes = new Map();
  for (const [, si] of graphOfNode) {
    sizes.set(si, (sizes.get(si) || 0) + 1);
  }
  const massOf = (id) => {
    const si = graphOfNode.get(id);
    if (si === anchorSi) return 1e9;
    return Math.max(1, Math.pow(sizes.get(si) || 1, 2));
  };

  const minNodeEdgeGap = nodeRadius + 32;
  const minEdgeEdgeGap = 28;
  const enableEdgeEdge = n <= 80 && graph.edges.length <= 120;

  const edgeList = graph.edges.map(e => ({
    a: graph.node(e.from),
    b: graph.node(e.to),
  })).filter(e => e.a && e.b);

  /* ---------- Фаза push: node-node, node-edge, edge-edge ---------- */
  const iterations = 30;
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;

    // --- 1. Node-node ---
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = graph.nodes[i], b = graph.nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minNodeSep) continue;
        moved = true;

        let ux, uy;
        if (dist < 0.01) {
          const ang = (i * 2.7 + j * 1.3) % (Math.PI * 2);
          ux = Math.cos(ang); uy = Math.sin(ang);
        } else {
          ux = dx / dist; uy = dy / dist;
        }

        const overlap = minNodeSep - dist;
        const mA = massOf(a.id), mB = massOf(b.id);
        const total = mA + mB;
        const f = 0.6;
        a.x -= ux * overlap * (mB / total) * f;
        a.y -= uy * overlap * (mB / total) * f;
        b.x += ux * overlap * (mA / total) * f;
        b.y += uy * overlap * (mA / total) * f;
      }
    }

    // --- 2. Node-edge ---
    for (const node of graph.nodes) {
      for (const { a, b } of edgeList) {
        if (a.id === node.id || b.id === node.id) continue;

        const cp = pointSegmentClosest(node.x, node.y, a.x, a.y, b.x, b.y);
        let dx = node.x - cp.x, dy = node.y - cp.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minNodeEdgeGap) continue;
        moved = true;

        if (dist < 0.01) {
          const ex = b.x - a.x, ey = b.y - a.y;
          const len = Math.hypot(ex, ey) || 1;
          dx = -ey / len; dy = ex / len; dist = 1;
        }

        const overlap = minNodeEdgeGap - dist;
        const mN = massOf(node.id);
        const mE = (massOf(a.id) + massOf(b.id)) / 2;
        const total = mN + mE;
        const f = 0.45;

        const nodeShare = mE / total;
        const edgeShare = (mN / total) * 0.4;

        node.x += (dx / dist) * overlap * nodeShare * f;
        node.y += (dy / dist) * overlap * nodeShare * f;

        a.x -= (dx / dist) * overlap * edgeShare * f;
        a.y -= (dy / dist) * overlap * edgeShare * f;
        b.x -= (dx / dist) * overlap * edgeShare * f;
        b.y -= (dy / dist) * overlap * edgeShare * f;
      }
    }

    // --- 3. Edge-edge ---
    if (enableEdgeEdge) {
      for (let i = 0; i < edgeList.length; i++) {
        for (let j = i + 1; j < edgeList.length; j++) {
          const e1 = edgeList[i], e2 = edgeList[j];
          if (e1.a.id === e2.a.id || e1.a.id === e2.b.id ||
              e1.b.id === e2.a.id || e1.b.id === e2.b.id) continue;

          const res = segmentSegmentClosest(e1.a, e1.b, e2.a, e2.b);
          if (res.dist >= minEdgeEdgeGap) continue;
          moved = true;

          let dx = res.p2.x - res.p1.x;
          let dy = res.p2.y - res.p1.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 0.01) {
            const ex = e1.b.x - e1.a.x, ey = e1.b.y - e1.a.y;
            const len = Math.hypot(ex, ey) || 1;
            dx = -ey / len; dy = ex / len; dist = 1;
          }

          const overlap = minEdgeEdgeGap - res.dist;
          const m1 = (massOf(e1.a.id) + massOf(e1.b.id)) / 2;
          const m2 = (massOf(e2.a.id) + massOf(e2.b.id)) / 2;
          const total = m1 + m2;
          const f = 0.35;

          const push1 = overlap * (m2 / total) * f;
          const push2 = overlap * (m1 / total) * f;

          e1.a.x -= (dx / dist) * push1 * 0.5;
          e1.a.y -= (dy / dist) * push1 * 0.5;
          e1.b.x -= (dx / dist) * push1 * 0.5;
          e1.b.y -= (dy / dist) * push1 * 0.5;

          e2.a.x += (dx / dist) * push2 * 0.5;
          e2.a.y += (dy / dist) * push2 * 0.5;
          e2.b.x += (dx / dist) * push2 * 0.5;
          e2.b.y += (dy / dist) * push2 * 0.5;
        }
      }
    }

    if (!moved) break;
  }

  /* ---------- Cleanup: тянем к rigid-body home, если безопасно ---------- */
  for (let iter = 0; iter < 15; iter++) {
    let moved = false;
    for (const node of graph.nodes) {
      const home = homeMap.get(node.id);
      if (!home) continue;
      const dx = home.x - node.x, dy = home.y - node.y;
      if (Math.hypot(dx, dy) < 1) continue;

      const targetX = node.x + dx * 0.25;
      const targetY = node.y + dy * 0.25;

      let safe = true;
      for (const other of graph.nodes) {
        if (other === node) continue;
        if (Math.hypot(targetX - other.x, targetY - other.y) < minNodeSep - 2) {
          safe = false; break;
        }
      }
      if (safe) {
        for (const { a, b } of edgeList) {
          if (a.id === node.id || b.id === node.id) continue;
          const cp = pointSegmentClosest(targetX, targetY, a.x, a.y, b.x, b.y);
          if (Math.hypot(targetX - cp.x, targetY - cp.y) < minNodeEdgeGap - 2) {
            safe = false; break;
          }
        }
      }

      if (safe) {
        node.x = targetX;
        node.y = targetY;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/* ===================================================================== */
/*  Kabsch                                                               */
/* ===================================================================== */
/* ---------- Геометрия ------------------------------------------------ */

function pointSegmentClosest(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, y: ay + t * dy };
}

function segmentSegmentClosest(a1, a2, b1, b2) {
  // Возвращает { dist, p1: {x,y}, p2: {x,y} } — ближайшие точки на двух
  // отрезках и расстояние между ними.
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const rx = a1.x - b1.x, ry = a1.y - b1.y;

  const A = d1x * d1x + d1y * d1y;
  const E = d2x * d2x + d2y * d2y;
  const F = d2x * rx + d2y * ry;

  const eps = 1e-9;
  let s, t;

  if (A <= eps && E <= eps) {
    s = t = 0;
  } else if (A <= eps) {
    s = 0;
    t = Math.max(0, Math.min(1, F / E));
  } else {
    const C = d1x * rx + d1y * ry;
    if (E <= eps) {
      t = 0;
      s = Math.max(0, Math.min(1, -C / A));
    } else {
      const B = d1x * d2x + d1y * d2y;
      const denom = A * E - B * B;
      s = denom !== 0
        ? Math.max(0, Math.min(1, (B * F - C * E) / denom))
        : 0;
      t = (B * s + F) / E;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -C / A));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (B - C) / A));
      }
    }
  }

  const p1 = { x: a1.x + s * d1x, y: a1.y + s * d1y };
  const p2 = { x: b1.x + t * d2x, y: b1.y + t * d2y };
  const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  return { dist, p1, p2 };
}
function kabsch(pairs) {
  let lcx = 0, lcy = 0, pcx = 0, pcy = 0;
  for (const p of pairs) {
    lcx += p.lx; lcy += p.ly;
    pcx += p.tx; pcy += p.ty;
  }
  lcx /= pairs.length; lcy /= pairs.length;
  pcx /= pairs.length; pcy /= pairs.length;

  let sxx = 0, sxy = 0, syx = 0, syy = 0;
  for (const p of pairs) {
    const lx = p.lx - lcx, ly = p.ly - lcy;
    const px = p.tx - pcx, py = p.ty - pcy;
    sxx += lx * px; sxy += lx * py;
    syx += ly * px; syy += ly * py;
  }

  const angle = Math.atan2(sxy - syx, sxx + syy);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const tx = pcx - (cos * lcx - sin * lcy);
  const ty = pcy - (sin * lcx + cos * lcy);

  return { cos, sin, tx, ty };
}

/* -------- обратная совместимость -------------------------------------- */

export function fitToCanvas(graph, canvas, padding = 40) {
  if (graph.nodes.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of graph.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const scale = Math.min(
    (canvas.width - padding * 2) / w,
    (canvas.height - padding * 2) / h,
    1.5,
  );
  const ox = (canvas.width - w * scale) / 2 - minX * scale;
  const oy = (canvas.height - h * scale) / 2 - minY * scale;
  for (const n of graph.nodes) {
    n.x = n.x * scale + ox;
    n.y = n.y * scale + oy;
  }
}

export function forceDirectedLayout() { /* no-op */ }