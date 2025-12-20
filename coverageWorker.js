// Worker for computing coverage/overlap and performing heavier snapping/search work
self.addEventListener('message', async (e) => {
  const data = e.data;
  if (!data) return;
  if (data.type === 'check') {
    const {id, width, height, pieces, silhouette, strict} = data;
    const res = computeCoverageAndOverlapWorker(width, height, pieces, silhouette, strict);
    // Transfer overlay buffer
    self.postMessage({type: 'check-result', id, uncovered: res.uncovered, overlap: res.overlap, width, height, overlay: res.overlay.buffer}, [res.overlay.buffer]);
  } else if (data.type === 'snap') {
    const {id, width, height, pieces, silhouette, options} = data;
    const res = trySnapAllWorker(width, height, pieces, silhouette, options);
    self.postMessage({type: 'snap-result', id, improved: res.improved, pieces: res.pieces});
  }
});

function computeCoverageAndOverlapWorker(w, h, pieces, silhouette, strict=false) {
  const counts = new Uint8Array(w*h);
  const canvas = new OffscreenCanvas(w,h);
  const ctx = canvas.getContext('2d');

  // rasterize each piece and increment counts
  for (let piece of pieces) {
    ctx.clearRect(0,0,w,h);
    ctx.beginPath();
    ctx.moveTo(piece.points[0].x, piece.points[0].y);
    for (let i = 1; i < piece.points.length; i++) ctx.lineTo(piece.points[i].x, piece.points[i].y);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    const img = ctx.getImageData(0,0,w,h).data;
    for (let i = 0, pi = 0; i < img.length; i += 4, pi++) if (img[i+3] > 0) counts[pi]++;
  }

  // rasterize silhouette
  ctx.clearRect(0,0,w,h);
  ctx.beginPath();
  ctx.moveTo(silhouette[0].x, silhouette[0].y);
  for (let i = 1; i < silhouette.length; i++) ctx.lineTo(silhouette[i].x, silhouette[i].y);
  ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  const silImg = ctx.getImageData(0,0,w,h).data;

  const R = strict ? 0 : 1;
  let uncovered = 0, overlap = 0;
  const out = new Uint8ClampedArray(w*h*4);

  for (let pi = 0; pi < w*h; pi++) {
    const silAlpha = silImg[pi*4 + 3];
    if (!silAlpha) continue;
    const x = pi % w, y = Math.floor(pi / w);
    let covered = false, overlapped = false;
    for (let dy = -R; dy <= R && !covered; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx; if (nx < 0 || nx >= w) continue;
        const c = counts[ny*w + nx];
        if (c > 0) covered = true;
        if (c > 1) overlapped = true;
        if (covered && overlapped) break;
      }
    }
    if (!covered) { out[pi*4+0] = 255; out[pi*4+1] = 0; out[pi*4+2] = 0; out[pi*4+3] = 160; uncovered++; }
    else if (overlapped) { out[pi*4+0] = 0; out[pi*4+1] = 100; out[pi*4+2] = 255; out[pi*4+3] = 160; overlap++; }
    else { out[pi*4+3] = 0; }
  }

  return {uncovered, overlap, overlay: out};
}

// Basic worker-side snapping: similar to main thread's approach but runs in worker and returns improved pieces
function trySnapAllWorker(w, h, pieces, silhouette, options = {}) {
  const maxIter = options.maxIter || 2;
  const snapThreshold = options.snapThreshold || 24;
  const opLimit = options.opLimit || 10000;
  let ops = 0;
  let improved = false;

  function clonePts(p) { return p.map(pp => ({x:pp.x, y:pp.y})); }
  function applyScale(points, c, scale) { for (let p of points) { p.x = c.x + (p.x - c.x) * scale; p.y = c.y + (p.y - c.y) * scale; } }
  function rotatePoints(points, c, ang) { const rad = ang*Math.PI/180; for (let p of points) { const dx = p.x - c.x, dy = p.y - c.y; const rx = dx*Math.cos(rad)-dy*Math.sin(rad), ry = dx*Math.sin(rad)+dy*Math.cos(rad); p.x = c.x + rx; p.y = c.y + ry; } }
  function movePoints(points, dx, dy) { for (let p of points) { p.x += dx; p.y += dy; } }

  function centerOf(points) { let cx=0,cy=0; for (let p of points) {cx+=p.x;cy+=p.y;} return {x:cx/points.length,y:cy/points.length}; }

  function nearestPointOnSilhouette(x,y) {
    let best = {dist: Infinity, x:0,y:0};
    for (let i=0,j=silhouette.length-1;i<silhouette.length;j=i++){
      const ax = silhouette[j].x, ay = silhouette[j].y; const bx = silhouette[i].x, by = silhouette[i].y;
      const dx = bx-ax, dy = by-ay; const len2 = dx*dx+dy*dy; let t=0; if(len2>0) t=((x-ax)*dx+(y-ay)*dy)/len2; t=Math.max(0,Math.min(1,t)); const projx=ax+t*dx, projy=ay+t*dy; const d2=(projx-x)*(projx-x)+(projy-y)*(projy-y); if (d2 < best.dist) best = {dist:d2,x:projx,y:projy};
    }
    best.dist = Math.sqrt(best.dist); return best;
  }

  function scoreCoverageLocal(piecesLocal) {
    const res = computeCoverageAndOverlapWorker(w,h,piecesLocal,silhouette,false);
    return res.uncovered + res.overlap;
  }

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    let baseScore = scoreCoverageLocal(pieces);
    if (baseScore === 0) break;
    for (let pi=0;pi<pieces.length;pi++){
      const piece = pieces[pi];
      const original = clonePts(piece.points);
      let bestLocal = {score: baseScore, points: null};
      for (let vi = 0; vi < original.length; vi++) {
        const v = original[vi];
        const np = nearestPointOnSilhouette(v.x, v.y);
        if (np.dist <= snapThreshold) {
          const angles = [0,90,-90];
          const scales = [0.99,1.00,1.01];
          for (let scale of scales) {
            for (let ang of angles) {
              let tmp = clonePts(original);
              const c = centerOf(tmp);
              applyScale(tmp, c, scale);
              rotatePoints(tmp, c, ang);
              const rv = tmp[vi];
              const dx = np.x - rv.x, dy = np.y - rv.y;
              movePoints(tmp, dx, dy);
              const s = scoreCoverageLocal(pieces.map((pp, idx) => idx===pi ? {points: tmp} : pp));
              ops++; if (ops > opLimit) break;
              if (s < bestLocal.score) bestLocal = {score: s, points: tmp};
            }
            if (ops > opLimit) break;
          }
        }
        if (ops > opLimit) break;
      }
      if (bestLocal.points) { pieces[pi].points = bestLocal.points; baseScore = bestLocal.score; changed = true; }
      else pieces[pi].points = original;
      if (ops > opLimit) break;
    }
    if (ops > opLimit) break;
    if (!changed) break; else improved = true;
  }

  return {improved, pieces};
}
