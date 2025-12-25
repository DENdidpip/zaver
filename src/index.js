
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
canvas.style.cursor = 'grab';
let pieces = [];
let silhouette = null;
let selected = null;
let lastPointer = null;
let badPoints = [];
let coverageOverlay = null; // canvas with visual overlay for uncovered/overlap pixels
let _stateVersion = 0; // incremented on user interactions to invalidate background jobs
let _bgJob = null;
let _worker = null;
let _workerRequestId = 0;
const _pendingWorker = new Map();
let _workerBusy = false;
function updateWorkerStatus() {
  const el = document.getElementById('workerStatus');
  if (!el) return;
  el.textContent = 'Worker: ' + (_worker ? (_workerBusy ? 'busy' : 'idle') : 'n/a');
}

if (window.Worker) {
  try {
    _worker = new Worker('coverageWorker.js');
    _worker.addEventListener('message', e => {
      const d = e.data;
      // mark worker idle and update status
      _workerBusy = false;
      updateWorkerStatus();
      if (!d || !d.id) return;
      const resolver = _pendingWorker.get(d.id);
      if (!resolver) return;
      _pendingWorker.delete(d.id);
      try { resolver(d); } catch (err) { console.error('Worker resolver error', err); }
    });
  } catch (err) { _worker = null; }
}

function workerCheckAsync(strict = false) {
  return new Promise(resolve => {
    if (!_worker) {
      // fallback: compute synchronously (rare)
      const res = computeCoverageAndOverlap(strict);
      let buf = null;
      if (res.overlay && res.overlay.getContext) {
        try {
          const tmpCtx = res.overlay.getContext('2d');
          const img = tmpCtx.getImageData(0,0,canvas.width,canvas.height);
          buf = img.data.buffer.slice(0);
        } catch (err) { buf = null; }
      } else if (res.overlay && res.overlay.data) {
        buf = res.overlay.data.buffer.slice(0);
      }
      resolve({type: 'check-result', id: null, uncovered: res.uncovered, overlap: res.overlap, width: canvas.width, height: canvas.height, overlay: buf});
      return;
    }
    const id = ++_workerRequestId;
    _workerBusy = true; updateWorkerStatus();
    const resolver = (d) => { _workerBusy = false; updateWorkerStatus(); resolve(d); };
    _pendingWorker.set(id, resolver);
    _worker.postMessage({type: 'check', id, width: canvas.width, height: canvas.height, pieces: pieces.map(p=>({points:p.points})), silhouette, strict});
  });
}

function workerSnapAsync(options = {}) {
  return new Promise(resolve => {
    if (!_worker) { resolve({type:'snap-result', id:null, improved:false}); return; }
    const id = ++_workerRequestId;
    _workerBusy = true; updateWorkerStatus();
    const resolver = (d) => { _workerBusy = false; updateWorkerStatus(); resolve(d); };
    _pendingWorker.set(id, resolver);
    _worker.postMessage({type:'snap', id, width: canvas.width, height: canvas.height, pieces: pieces.map(p=>({points:p.points})), silhouette, options});
  });
}

let originalLevel = null;

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Check for win condition
function checkWinCondition() {
  console.log('Проверяем условие выигрыша...'); // Отладка
  
  // Получаем допуск из поля ввода
  const toleranceInput = document.getElementById('tolerance');
  const tolerance = toleranceInput ? parseInt(toleranceInput.value) || 1000 : 1000;
  
  // Сначала проверяем, что все фигуры находятся внутри или на границе силуэта
  let allPiecesInSilhouette = true;
  for (let piece of pieces) {
    for (let point of piece.points) {
      if (!pointInOrOnPoly(point.x, point.y, silhouette)) {
        allPiecesInSilhouette = false;
        break;
      }
    }
    if (!allPiecesInSilhouette) break;
  }
  
  if (!allPiecesInSilhouette) {
    document.getElementById('message').textContent = '⚠️ Некоторые фигуры находятся вне силуэта';
    return false;
  }
  
  const result = computeCoverageAndOverlap(true); // strict check
  
  console.log('Результат проверки:', result); // Отладка
  console.log('Незакрашенных пикселей:', result.uncovered);
  console.log('Перекрывающихся пикселей:', result.overlap);
  console.log('Допуск:', tolerance); // Отладка
  
  // Условие победы с допуском
  if (result.uncovered < tolerance && result.overlap < tolerance) {
    console.log('ПОБЕДА ОБНАРУЖЕНА с допуском!'); // Отладка
    showWinMessage();
    return true;
  }
  
  // Показываем прогресс с учетом допуска
  if (result.uncovered >= tolerance) {
    const remaining = result.uncovered - tolerance + 1;
    document.getElementById('message').textContent = `Осталось заполнить: ${remaining} пикселей (допуск: ${tolerance})`;
  } else if (result.overlap >= tolerance) {
    const excess = result.overlap - tolerance + 1;
    document.getElementById('message').textContent = `⚠️ Слишком много перекрытий: ${excess} лишних пикселей (допуск: ${tolerance})`;
  } else {
    // Если мы здесь, значит одно условие выполнено, а другое почти
    let message = 'Почти готово! ';
    if (result.uncovered > 0) {
      message += `Незакрашено: ${result.uncovered} пикселей (норма). `;
    }
    if (result.overlap > 0) {
      message += `Перекрытий: ${result.overlap} пикселей (норма).`;
    }
    document.getElementById('message').textContent = message;
  }
  
  return false;
}

// Show win message with animation
function showWinMessage() {
  const messageEl = document.getElementById('message');
  messageEl.innerHTML = '🎉 <span style="color: #2ecc71; font-size: 24px; font-weight: bold;">ПОБЕДА!</span> 🎉<br><span style="color: #333;">Вы успешно собрали танграм!</span>';
  
  // Add celebration animation
  messageEl.style.animation = 'none';
  setTimeout(() => {
    messageEl.style.animation = 'winPulse 2s ease-in-out infinite';
  }, 10);
  
  // Clear overlay and bad points
  badPoints = [];
  coverageOverlay = null;
  
  // Optional: добавляем конфетти или другие эффекты
  celebrateWin();
}

// Simple celebration effect
function celebrateWin() {
  // Change canvas border to indicate victory
  canvas.style.border = '5px solid #2ecc71';
  canvas.style.boxShadow = '0 0 20px rgba(46, 204, 113, 0.5)';
  
  // Reset after a few seconds
  setTimeout(() => {
    canvas.style.border = '';
    canvas.style.boxShadow = '';
  }, 5000);
}
function updateBadPoints() {
  badPoints = [];
  if (!silhouette) return;
  for (let pi = 0; pi < pieces.length; pi++) {
    const piece = pieces[pi];
    for (let pti = 0; pti < piece.points.length; pti++) {
      const pt = piece.points[pti];
      if (!pointInOrOnPoly(pt.x, pt.y, silhouette)) badPoints.push({x:pt.x, y:pt.y, piece:pi, idx:pti});
    }
    for (let i = 0; i < piece.points.length; i++) {
      const a = piece.points[i];
      const b = piece.points[(i+1) % piece.points.length];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!pointInOrOnPoly(mx, my, silhouette)) badPoints.push({x:mx, y:my, piece:pi, idx:`m${i}`});
    }
  }
  if (badPoints.length) {
    document.getElementById('message').textContent = `⚠️ ${badPoints.length} точек вне силуэта — покажу их красными.`;
  } else {
    document.getElementById('message').textContent = '';
  }
}

class Piece {
  constructor(points, color) {
    // deep copy
    this.points = points.map(p => ({x:p.x, y:p.y}));
    this.color = color;
    this.dragging = false;
  }

  draw() {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  isInside(x, y) {
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    ctx.closePath();
    return ctx.isPointInPath(x, y);
  }

  move(dx, dy) { 
    // Сохраняем исходные позиции
    const originalPoints = this.points.map(p => ({x: p.x, y: p.y}));
    
    // Пробуем переместить
    for (let p of this.points) { 
      p.x += dx; 
      p.y += dy; 
    }
    
    // Проверяем коллизии с другими фигурами
    for (let otherPiece of pieces) {
      if (otherPiece !== this && piecesOverlap(this, otherPiece)) {
        // Отменяем перемещение, возвращаем исходные позиции
        this.points = originalPoints;
        return false; // Перемещение заблокировано
      }
    }
    
    return true; // Перемещение успешно
  }

  rotate(angle) {
    const c = this.center();
    const rad = angle * Math.PI/180;
    for (let p of this.points) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      p.x = c.x + dx*Math.cos(rad) - dy*Math.sin(rad);
      p.y = c.y + dx*Math.sin(rad) + dy*Math.cos(rad);
    }
  }

  center() {
    const cx = this.points.reduce((s,p)=>s+p.x,0)/this.points.length;
    const cy = this.points.reduce((s,p)=>s+p.y,0)/this.points.length;
    return {x:cx, y:cy};
  }
}

function drawSilhouette(poly) {
  if (!poly) return;
  ctx.save();
  ctx.fillStyle = '#f0f0f0';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawAll() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawSilhouette(silhouette);
  // draw pieces in order
  for (let p of pieces) p.draw();
  // draw coverage overlay (uncovered = red, overlaps = blue)
  if (coverageOverlay) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.drawImage(coverageOverlay, 0, 0);
    ctx.restore();
  }
  // draw debug markers for bad points
  if (badPoints && badPoints.length) {
    ctx.save();
    for (let bp of badPoints) {
      ctx.beginPath();
      ctx.fillStyle = 'red';
      ctx.arc(bp.x, bp.y, 4, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  }
}

// Compute coverage and overlap using pixel masks. Returns {uncovered, overlap, overlayCanvas}
function computeCoverageAndOverlap(strict = false) {
  if (!silhouette) return {uncovered:0, overlap:0, overlay:null};
  const w = canvas.width, h = canvas.height;
  const counts = new Uint8Array(w * h);

  if (!computeCoverageAndOverlap._tmp) {
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    computeCoverageAndOverlap._tmp = {canvas: tmp, ctx: tctx};
  }
  const tmpObj = computeCoverageAndOverlap._tmp;
  if (tmpObj.canvas.width !== w || tmpObj.canvas.height !== h) {
    tmpObj.canvas.width = w; tmpObj.canvas.height = h;
  }
  const tctx = tmpObj.ctx;

  // rasterize each piece and increment counts
  for (let piece of pieces) {
    tctx.clearRect(0,0,w,h);
    tctx.beginPath();
    tctx.moveTo(piece.points[0].x, piece.points[0].y);
    for (let i = 1; i < piece.points.length; i++) tctx.lineTo(piece.points[i].x, piece.points[i].y);
    tctx.closePath();
    tctx.fillStyle = '#ffffff';
    tctx.fill();
    const data = tctx.getImageData(0,0,w,h).data;
    for (let i = 0, pi = 0; i < data.length; i += 4, pi++) {
      if (data[i+3] > 0) counts[pi]++;
    }
  }

  // rasterize silhouette
  tctx.clearRect(0,0,w,h);
  tctx.beginPath();
  tctx.moveTo(silhouette[0].x, silhouette[0].y);
  for (let i = 1; i < silhouette.length; i++) tctx.lineTo(silhouette[i].x, silhouette[i].y);
  tctx.closePath();
  tctx.fillStyle = '#ffffff';
  tctx.fill();
  const silData = tctx.getImageData(0,0,w,h).data;

  let uncovered = 0, overlap = 0;
  const R = strict ? 0 : 1;
  const overlay = document.createElement('canvas'); overlay.width = w; overlay.height = h;
  const octx = overlay.getContext('2d');
  const img = octx.createImageData(w,h);
  const out = img.data;

  for (let pi = 0; pi < w*h; pi++) {
    const silAlpha = silData[pi*4 + 3];
    if (silAlpha === 0) continue;
    const x = pi % w, y = Math.floor(pi / w);
    let covered = false, overlapped = false;
    for (let dy = -R; dy <= R && !covered; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx; if (nx < 0 || nx >= w) continue;
        const c = counts[ny * w + nx];
        if (c > 0) covered = true;
        if (c > 1) overlapped = true;
        if (covered && overlapped) break;
      }
    }
    if (!covered) {
      out[pi*4+0] = 255; out[pi*4+1] = 0; out[pi*4+2] = 0; out[pi*4+3] = 160; uncovered++;
    } else if (overlapped) {
      out[pi*4+0] = 0; out[pi*4+1] = 100; out[pi*4+2] = 255; out[pi*4+3] = 160; overlap++;
    } else {
      out[pi*4+3] = 0;
    }
  }
  octx.putImageData(img, 0, 0);
  return {uncovered, overlap, overlay};
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function clonePoints(points) { return points.map(p => ({x:p.x, y:p.y})); }

function applyScaleToPiece(piece, scale) {
  const c = piece.center();
  for (let p of piece.points) {
    p.x = c.x + (p.x - c.x) * scale;
    p.y = c.y + (p.y - c.y) * scale;
  }
}

function nearestPointOnSilhouette(x, y) {
  let best = {dist: Infinity, x: null, y: null};
  for (let i = 0, j = silhouette.length - 1; i < silhouette.length; j = i++) {
    const ax = silhouette[j].x, ay = silhouette[j].y;
    const bx = silhouette[i].x, by = silhouette[i].y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx*dx + dy*dy;
    let t = 0;
    if (len2 > 0) t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projx = ax + t * dx, projy = ay + t * dy;
    const dist2 = (projx - x)*(projx - x) + (projy - y)*(projy - y);
    if (dist2 < best.dist) best = {dist: dist2, x: projx, y: projy};
  }
  best.dist = Math.sqrt(best.dist);
  return best;
}

function pieceHeuristicPoints(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    const np = nearestPointOnSilhouette(v.x, v.y);
    s += np.dist;
    const a = v;
    const b = points[(i+1)%points.length];
    const mx = (a.x + b.x)/2, my = (a.y + b.y)/2;
    const n2 = nearestPointOnSilhouette(mx, my);
    s += n2.dist;
  }
  return s;
}

function scoreCoverage() {
  const r = computeCoverageAndOverlap();
  return r.uncovered + r.overlap;
}

function trySnapAll(maxIter = 2, snapThreshold = 20, opLimit = 2000) {
  if (!silhouette) return false;
  let improved = false;
  let ops = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    let baseScore = scoreCoverage();
    if (baseScore === 0) break; // nothing to improve
    for (let pi = 0; pi < pieces.length; pi++) {
      const piece = pieces[pi];
      const original = clonePoints(piece.points);
      let bestLocal = {score: baseScore, points: null};
      for (let vi = 0; vi < original.length; vi++) {
        const v = original[vi];
        const np = nearestPointOnSilhouette(v.x, v.y);
        if (np.dist <= snapThreshold) {
          const angles = [0, 90, -90];
          const scales = [0.99, 1.00, 1.01];
          for (let scale of scales) {
            for (let ang of angles) {
              piece.points = clonePoints(original);
              applyScaleToPiece(piece, scale);
              piece.rotate(ang);
              const rv = piece.points[vi];
              const dx = np.x - rv.x, dy = np.y - rv.y;
              piece.move(dx, dy);
              const s = scoreCoverage();
              ops++;
              if (ops > opLimit) break;
              if (s < bestLocal.score) bestLocal = {score: s, points: clonePoints(piece.points)};
            }
            if (ops > opLimit) break;
          }
        }
        if (ops > opLimit) break;
      }
      if (ops > opLimit) break;
      if (bestLocal.points) {
        piece.points = bestLocal.points;
        baseScore = bestLocal.score;
        changed = true;
      } else {
        piece.points = original;
      }
    }
    if (ops > opLimit) break;
    if (changed) improved = true; else break;
  }
  return improved;
}

function pointInOrOnPoly(x, y, poly, tol = 1.5) {
  if (!poly || poly.length === 0) return false;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  if (ctx.isPointInPath(x, y)) return true;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].x, ay = poly[j].y;
    const bx = poly[i].x, by = poly[i].y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx*dx + dy*dy;
    let t = 0;
    if (len2 > 0) t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projx = ax + t * dx, projy = ay + t * dy;
    const dist2 = (projx - x) * (projx - x) + (projy - y) * (projy - y);
    if (dist2 <= tol * tol) return true;
  }
  return false;
}

function checkVictory() {
  if (!silhouette) return false;
  for (let piece of pieces) {
    for (let pt of piece.points) {
      if (!pointInOrOnPoly(pt.x, pt.y, silhouette)) return false;
    }
    for (let i = 0; i < piece.points.length; i++) {
      const a = piece.points[i];
      const b = piece.points[(i+1) % piece.points.length];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!pointInOrOnPoly(mx, my, silhouette)) return false;
    }
  }
  return true;
}

canvas.addEventListener('pointerdown', e => {
  _stateVersion++;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  for (let i = pieces.length - 1; i >= 0; i--) { // top-most first
    const p = pieces[i];
    if (p.isInside(x, y)) {
      selected = p;
      selected.dragging = true;
      canvas.style.cursor = 'grabbing';
      pieces.splice(i,1);
      pieces.push(selected);
      lastPointer = {x, y};
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) {}
      updateBadPoints();
      drawAll();
      return;
    }
  }
});

function endDrag() {
  if (selected) selected.dragging = false;
  selected = null;
  canvas.style.cursor = 'grab';
  lastPointer = null;
}

canvas.addEventListener('pointercancel', e => {
  try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  endDrag();
  drawAll();
});

window.addEventListener('pointerup', e => {
  if (selected) {
    try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    endDrag();
    drawAll();
  }
});

canvas.addEventListener('pointermove', e => {
  if (!selected || !selected.dragging) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const dx = x - lastPointer.x;
  const dy = y - lastPointer.y;
  selected.move(dx, dy);
  lastPointer = {x, y};
  updateBadPoints();
  drawAll();
  
  // Убираем автоматическую проверку выигрыша во время перетаскивания
  // checkWinCondition();
});

canvas.addEventListener('pointerup', e => {
  if (selected) selected.dragging = false;
  selected = null;
  canvas.style.cursor = 'grab';
  // Auto-snap disabled: avoid auto-moving pieces when they are overlapping or touching.
  // trySnapAll(1, 20, 400, true);
  const resQuick = computeCoverageAndOverlap(false);
  coverageOverlay = resQuick.overlay;
  updateBadPoints();
  drawAll();
  
  // Убираем автоматическую проверку выигрыша при окончании перетаскивания
  // if (checkWinCondition()) {
  //   return; // Если победа, не выполняем дальнейшие проверки
  // }

  const myVersion = _stateVersion;
  if (_bgJob) {
    try { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(_bgJob.id); else clearTimeout(_bgJob.id); } catch (err) {}
    _bgJob = null;
  }

  if (_worker) {
    // do NOT request a worker snap that moves pieces; instead only run coverage checks
    workerCheckAsync(false).then(sr => {
      coverageOverlay = sr.overlay ? bufferToCanvas(sr.width, sr.height, sr.overlay) : null;
      workerCheckAsync(true).then(sr2 => {
        if (sr2.uncovered === 0 && sr2.overlap === 0) {
          document.getElementById('message').textContent = '🎉 Победа! Фигуры покрывают силуэт без перекрытий.';
          badPoints = [];
          coverageOverlay = null;
          setTimeout(() => alert('🎉 Победа! Все фигуры правильно размещены.'), 100);
        } else {
          const parts = [];
          if (sr2.uncovered > 0) parts.push(`${sr2.uncovered} незакрытых пикселей`);
          if (sr2.overlap > 0) parts.push(`${sr2.overlap} пикселей перекрытия`);
          if (badPoints.length) parts.push(`${badPoints.length} вершин/середин вне силуэта`);
          document.getElementById('message').textContent = `⚠️ ${parts.join(', ')} — покажу на холсте.`;
        }
        drawAll();
      });
    });
  } else {
    const resQuick = computeCoverageAndOverlap(false);
    coverageOverlay = resQuick.overlay;
    updateBadPoints();
    const resStrict = computeCoverageAndOverlap(true);
    if (resStrict.uncovered === 0 && resStrict.overlap === 0) {
      document.getElementById('message').textContent = '🎉 Победа! Фигуры покрывают силуэт без перекрытий.';
      badPoints = [];
      coverageOverlay = null;
      setTimeout(() => alert('🎉 Победа! Все фигуры правильно размещены.'), 100);
    } else {
      const parts = [];
      if (resQuick.uncovered > 0) parts.push(`${resQuick.uncovered} незакрытых пикселей`);
      if (resQuick.overlap > 0) parts.push(`${resQuick.overlap} пикселей перекрытия`);
      if (badPoints.length) parts.push(`${badPoints.length} вершин/середин вне силуэта`);
      document.getElementById('message').textContent = `⚠️ ${parts.join(', ')} — покажу на холсте.`;
    }
    drawAll();
  }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.isInside(x, y)) {
      p.rotate(45);
      updateBadPoints();
      drawAll();
      
      // Убираем автоматическую проверку выигрыша
      // if (checkWinCondition()) {
      //   return;
      // }
      
      // async coverage check via worker when available
      workerCheckAsync(false).then(sr => {
        coverageOverlay = sr.overlay ? bufferToCanvas(sr.width, sr.height, sr.overlay) : null;
        drawAll();
      });
      break;
    }
  }
});

canvas.addEventListener('dblclick', e => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.isInside(x, y)) {
      p.rotate(90);
      updateBadPoints();
      drawAll();
      
      // Убираем автоматическую проверку выигрыша
      // if (checkWinCondition()) {
      //   return;
      // }
      
      workerCheckAsync(false).then(sr => {
        coverageOverlay = sr.overlay ? bufferToCanvas(sr.width, sr.height, sr.overlay) : null;
        drawAll();
      });
      break;
    }
  }
});

// fallback level (used if fetch fails, e.g. opened via file://)
const fallbackLevel = {
  "levelId": 1,
  "name": "Square",
  "silhouette": [ {"x":200,"y":200},{"x":400,"y":200},{"x":400,"y":400},{"x":200,"y":400} ],
  "pieces": [
    {"type":"triangle","points":[{"x":50,"y":50},{"x":150,"y":50},{"x":50,"y":150}],"color":"#e74c3c"},
    {"type":"triangle","points":[{"x":150,"y":50},{"x":150,"y":150},{"x":50,"y":150}],"color":"#3498db"},
    {"type":"triangle","points":[{"x":50,"y":150},{"x":150,"y":150},{"x":100,"y":200}],"color":"#2ecc71"},
    {"type":"triangle","points":[{"x":150,"y":150},{"x":200,"y":150},{"x":150,"y":200}],"color":"#f39c12"},
    {"type":"triangle","points":[{"x":150,"y":150},{"x":200,"y":150},{"x":150,"y":200}],"color":"#f39c12"},
    {"type":"triangle","points":[{"x":150,"y":150},{"x":200,"y":150},{"x":150,"y":200}],"color":"#f39c12"},
    {"type":"square","points":[{"x":100,"y":100},{"x":150,"y":100},{"x":150,"y":150},{"x":100,"y":150}],"color":"#9b59b6"},
    {"type":"parallelogram","points":[{"x":50,"y":50},{"x":100,"y":50},{"x":150,"y":100},{"x":100,"y":100}],"color":"#ff7ab6"},
    {"type":"triangle","points":[{"x":150,"y":50},{"x":200,"y":50},{"x":150,"y":100}],"color":"#1abc9c"}
  ]
};

fetch('level1.json').then(r => r.json()).then(level => {
  silhouette = level.silhouette;
  originalLevel = deepClone(level);
  normalizeLevel(level);
  pieces = level.pieces.map(p => new Piece(p.points, p.color));
  arrangePiecesInRow();
  drawAll();
}).catch(err => {
  console.warn('Failed to load level1.json, using fallback level:', err);
  silhouette = fallbackLevel.silhouette;
  originalLevel = deepClone(fallbackLevel);
  normalizeLevel(fallbackLevel);
  pieces = fallbackLevel.pieces.map(p => new Piece(p.points, p.color));
  // Inform the user about file:// fetch restriction and fallback
  const msgEl = document.getElementById('message');
  msgEl.textContent = '⚠️ Используется встроенный уровень (fallback).';
  if (location && location.protocol === 'file:') {
    msgEl.textContent += ' (Файлы открыты через file:// — браузер блокирует fetch. Для загрузки уровня запустите локальный HTTP-сервер, например: `python -m http.server` и откройте http://localhost:8000/)';
  }
  arrangePiecesInRow();
  drawAll();
});


// Convert an overlay ArrayBuffer into a canvas for drawing
function bufferToCanvas(width, height, buf) {
  const arr = new Uint8ClampedArray(buf);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const cctx = c.getContext('2d');
  const img = cctx.createImageData(width, height);
  img.data.set(arr);
  cctx.putImageData(img, 0, 0);
  return c;
}

updateWorkerStatus();

// Helpers: compute bounding box of a set of points
function getBBox(points) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minx = Math.min(...xs), maxx = Math.max(...xs);
  const miny = Math.min(...ys), maxy = Math.max(...ys);
  return {minx, miny, maxx, maxy, width: maxx - minx, height: maxy - miny};
}

// Get bounding box of a piece
function getPieceBBox(piece) {
  return getBBox(piece.points);
}

// Check if two pieces overlap
function piecesOverlap(piece1, piece2) {
  const bbox1 = getPieceBBox(piece1);
  const bbox2 = getPieceBBox(piece2);
  
  // Quick bounding box check first
  if (bbox1.maxx < bbox2.minx || bbox2.maxx < bbox1.minx ||
      bbox1.maxy < bbox2.miny || bbox2.maxy < bbox1.miny) {
    return false;
  }
  
  // More detailed polygon intersection check
  // Check if any vertex of piece1 is inside piece2
  for (let pt of piece1.points) {
    if (piece2.isInside(pt.x, pt.y)) return true;
  }
  
  // Check if any vertex of piece2 is inside piece1
  for (let pt of piece2.points) {
    if (piece1.isInside(pt.x, pt.y)) return true;
  }
  
  return false;
}

// Arrange pieces in rows at the bottom of the canvas (simplified)
function arrangePiecesInRow() {
  const startY = canvas.height - 120; // Position from bottom
  const startX = 10; // Start position from left
  const spacing = 15; // Spacing between pieces
  const rowSpacing = 80; // Spacing between rows
  const maxWidth = canvas.width - 20; // Maximum width for pieces
  
  let currentX = startX;
  let currentY = startY;
  let maxHeightInRow = 0;
  
  for (let piece of pieces) {
    const bbox = getPieceBBox(piece);
    const pieceWidth = bbox.width;
    const pieceHeight = bbox.height;
    
    // Check if piece fits in current row
    if (currentX + pieceWidth > maxWidth && currentX > startX) {
      // Move to next row
      currentX = startX;
      currentY -= (maxHeightInRow + rowSpacing);
      maxHeightInRow = 0;
    }
    
    // Calculate center positions
    const centerX = (bbox.minx + bbox.maxx) / 2;
    const centerY = (bbox.miny + bbox.maxy) / 2;
    
    // Calculate target position
    const targetCenterX = currentX + pieceWidth / 2;
    const targetCenterY = currentY;
    
    // Move piece to target position (forced move, bypassing collision detection)
    const dx = targetCenterX - centerX;
    const dy = targetCenterY - centerY;
    for (let p of piece.points) { 
      p.x += dx; 
      p.y += dy; 
    }
    
    // Update positions for next piece
    currentX += pieceWidth + spacing;
    maxHeightInRow = Math.max(maxHeightInRow, pieceHeight);
  }
}

function normalizeLevel(level) {
  const sil = getBBox(level.silhouette);
  const allPoints = level.pieces.flatMap(p => p.points);
  const piecesBox = getBBox(allPoints);
  if (piecesBox.width === 0 || piecesBox.height === 0) return;
  const scale = Math.min(sil.width / piecesBox.width, sil.height / piecesBox.height);
  const scaledW = piecesBox.width * scale;
  const scaledH = piecesBox.height * scale;
  const offsetX = (sil.width - scaledW) / 2;
  const offsetY = (sil.height - scaledH) / 2;
  for (let piece of level.pieces) {
    for (let pt of piece.points) {
      pt.x = sil.minx + offsetX + (pt.x - piecesBox.minx) * scale;
      pt.y = sil.miny + offsetY + (pt.y - piecesBox.miny) * scale;
    }
  }
}
