// RearGuard hero animation (top-down): a car approaches from behind, the seatpost
// smartphone (rear camera + on-device inference) detects it, the handlebar LED warns
// the rider and the rear LED warns the driver, the car close-passes, loop (10s).
(function () {
  const root = document.querySelector('[data-rg-hero]');
  if (!root) return;
  const cv = root.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const $ = (n) => root.querySelector(`[data-rg="${n}"]`);
  const el = { state: $('state'), track: $('track'), chip: $('chip'), vig: $('vignette') };

  // Layout (logical px). Height is fixed at 430, width adapts (400..620+).
  const H = 430, PX = 20, V = 7, T = 10, CLOSE = 10, BS = 1.9;
  const ROAD_T = 70, CENTER = 140, ROAD_B = 210, SHOULDER_B = 222;
  const BIKE_Y = 196, LANE_Y = 175, PASS_Y = 144, CAR_L = 90, CAR_W = 36;
  const INSET_T = 238, INSET_B = 376;
  const WORLD = V * PX * T;                    // 1400px of road per loop -> seamless
  const COL = { cyan: '#4cd7f6', amber: '#ffb95f', red: '#ff5a52' };
  const FONT = '"JetBrains Mono", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", monospace';

  let dpr = 1, s = 1, ox = 0, oy = 0, LW = 620, BX = 434;
  let t = 0, lastNow = 0, raf = 0, visible = true;

  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const trees = [];
  for (let x = 0; x < WORLD; x += 34 + rnd() * 50) trees.push({ x, y: 10 + rnd() * 46, r: 12 + rnd() * 12, c: rnd() });
  for (let x = 20; x < WORLD; x += 60 + rnd() * 80) trees.push({ x, y: 236 + rnd() * 160, r: 12 + rnd() * 10, c: rnd() });
  const patches = Array.from({ length: 22 }, () => ({ x: rnd() * WORLD, y: ROAD_T + 8 + rnd() * 130, w: 10 + rnd() * 30, h: 3 + rnd() * 6 }));
  const tufts = Array.from({ length: 90 }, () => ({ x: rnd() * WORLD, y: rnd() < 0.4 ? rnd() * 66 : SHOULDER_B + 4 + rnd() * 200 }));

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sstep = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  const rgba = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))},${a})`;

  function poly(pts, fill) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function glow(x, y, r, color, a) {
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function text(str, x, y, size, color, weight = 600, align = 'left') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
    return ctx.measureText(str).width;
  }

  // Timeline: d = gap from car front to the seatpost camera (m)
  // st 0 clear, 1 detected, 2 danger, 3 passed (logged)
  function phase(t) {
    const d = CLOSE * (6.3 - t);
    const st = t < 2 ? 0 : t < 3.8 ? 1 : t < 6.3 ? 2 : t < 8.6 ? 3 : 0;
    // LED levels (0..1): handlebar = rider, rear = driver
    let hb, rear;
    if (st === 2) { hb = (t * 6) % 1 < 0.5 ? 1 : 0.08; rear = (t * 6) % 1 < 0.45 ? 1 : 0.05; }
    else if (st === 1 || (st === 3 && t < 7.8)) { hb = (t * 2) % 1 < 0.5 ? 0.95 : 0.15; rear = hb; }
    else { hb = 0.5; rear = 0.38; }
    const hbCol = st === 2 ? COL.red : st === 1 || (st === 3 && t < 7.8) ? COL.amber : COL.cyan;
    return { d, st, ttc: d / CLOSE, hb, rear, hbCol };
  }

  const camX = () => BX - 15 * BS;
  function carPos(d) {
    const k = d > 0 ? sstep(16, 5, d) : 1 - sstep(-9, -18, d);
    return { y: LANE_Y + (PASS_Y - LANE_Y) * k, front: camX() - d * PX };
  }

  // ---------- frame ----------
  function frame(t) {
    const ph = phase(t);
    const scroll = (V * PX * t) % WORLD;
    const wx = (x) => { let v = (((x - scroll) % WORLD) + WORLD) % WORLD; if (v > LW + 80) v -= WORLD; return v; };
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);

    // grass
    ctx.fillStyle = '#0e1511'; ctx.fillRect(-2, -2, LW + 4, H + 4);
    ctx.fillStyle = 'rgba(150,190,130,.07)';
    for (const g of tufts) ctx.fillRect(wx(g.x), g.y, 2, 2);

    // road
    ctx.fillStyle = '#2a2d34'; ctx.fillRect(-2, ROAD_T, LW + 4, ROAD_B - ROAD_T);
    ctx.fillStyle = '#24272d'; ctx.fillRect(-2, ROAD_B, LW + 4, SHOULDER_B - ROAD_B);
    ctx.fillStyle = 'rgba(0,0,0,.14)';
    for (const p of patches) { ctx.beginPath(); ctx.ellipse(wx(p.x), p.y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(230,232,238,.7)';
    ctx.fillRect(-2, ROAD_T + 2, LW + 4, 2.5);
    ctx.fillRect(-2, ROAD_B - 1.5, LW + 4, 2.5);
    ctx.fillStyle = 'rgba(233,185,73,.85)';
    const off = (V * PX * t) % 200;
    for (let x = -off; x < LW + 10; x += 200) ctx.fillRect(x, CENTER - 1.5, 60, 3);

    // roadside trees (top-down crowns)
    for (const tr of trees) {
      const x = wx(tr.x);
      if (x < -tr.r - 6 || x > LW + tr.r + 6) continue;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x + 4, tr.y + 5, tr.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tr.c > 0.5 ? '#12251a' : '#0f2016'; ctx.beginPath(); ctx.arc(x, tr.y, tr.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(80,130,90,.18)'; ctx.beginPath(); ctx.arc(x - tr.r * 0.3, tr.y - tr.r * 0.3, tr.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }

    // rear camera field of view (from the seatpost phone, looking back)
    const cx = camX();
    const coneCol = [COL.cyan, COL.amber, COL.red, COL.cyan][ph.st];
    let g = ctx.createLinearGradient(cx, 0, cx - 420, 0);
    g.addColorStop(0, rgba(coneCol, ph.st === 2 ? 0.26 : 0.18)); g.addColorStop(1, rgba(coneCol, 0));
    poly([[cx, BIKE_Y], [cx - 420, BIKE_Y - 190], [cx - 420, BIKE_Y + 150]], g);
    ctx.strokeStyle = rgba(coneCol, 0.35); ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(cx, BIKE_Y); ctx.lineTo(cx - 260, BIKE_Y - 118); ctx.moveTo(cx, BIKE_Y); ctx.lineTo(cx - 260, BIKE_Y + 93); ctx.stroke();
    ctx.setLineDash([]);

    const car = carPos(ph.d);
    drawCar(car);
    drawBike(ph);
    measure(t, ph, car);
    insets(t, ph, car);
    hud(t, ph);
  }

  function drawCar(car) {
    const fx = car.front, rx = fx - CAR_L, y0 = car.y - CAR_W / 2;
    if (fx < -10 || rx > LW + 200) return;
    // headlight beams forward
    const g = ctx.createLinearGradient(fx, 0, fx + 160, 0);
    g.addColorStop(0, 'rgba(255,238,200,.22)'); g.addColorStop(1, 'rgba(255,238,200,0)');
    poly([[fx, car.y - 14], [fx + 160, car.y - 46], [fx + 160, car.y + 46], [fx, car.y + 14]], g);
    // shadow + body
    rr(rx + 3, y0 + 4, CAR_L, CAR_W, 9); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
    const bg = ctx.createLinearGradient(0, y0, 0, y0 + CAR_W);
    bg.addColorStop(0, '#4b586c'); bg.addColorStop(0.5, '#3a4658'); bg.addColorStop(1, '#2c3644');
    rr(rx, y0, CAR_L, CAR_W, 9); ctx.fillStyle = bg; ctx.fill();
    // glass + roof
    poly([[rx + 58, y0 + 4], [rx + 68, y0 + 7], [rx + 68, y0 + CAR_W - 7], [rx + 58, y0 + CAR_W - 4]], '#0c1119');
    rr(rx + 28, y0 + 5, 30, CAR_W - 10, 4); ctx.fillStyle = '#4f5d72'; ctx.fill();
    poly([[rx + 18, y0 + 7], [rx + 28, y0 + 5], [rx + 28, y0 + CAR_W - 5], [rx + 18, y0 + CAR_W - 7]], '#0c1119');
    // mirrors
    ctx.fillStyle = '#2c3644'; ctx.fillRect(rx + 58, y0 - 4, 5, 4); ctx.fillRect(rx + 58, y0 + CAR_W, 5, 4);
    // lights
    ctx.fillStyle = '#fff6d8'; ctx.fillRect(fx - 4, y0 + 3, 3, 7); ctx.fillRect(fx - 4, y0 + CAR_W - 10, 3, 7);
    ctx.fillStyle = '#ff3b3b'; ctx.fillRect(rx + 1, y0 + 3, 3, 7); ctx.fillRect(rx + 1, y0 + CAR_W - 10, 3, 7);
    glow(rx, y0 + 6, 14, '#ff3b3b', 0.4); glow(rx, y0 + CAR_W - 6, 14, '#ff3b3b', 0.4);
  }

  function drawBike(ph) {
    ctx.save();
    ctx.translate(BX, BIKE_Y);
    ctx.scale(BS, BS);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(2, 3, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#07080b';
    rr(-19, -1.8, 15, 3.6, 1.8); ctx.fill();
    rr(4, -1.8, 15, 3.6, 1.8); ctx.fill();
    ctx.strokeStyle = '#6b7687'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.stroke();
    ctx.strokeStyle = '#1c2026'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(9, -8); ctx.lineTo(9, 8); ctx.stroke();
    // rider
    ctx.strokeStyle = '#33415a'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(1, -6); ctx.lineTo(9, -7); ctx.moveTo(1, 6); ctx.lineTo(9, 7); ctx.stroke();
    ctx.fillStyle = '#33415a'; ctx.beginPath(); ctx.ellipse(-1, 0, 6, 7.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6eaf0'; ctx.beginPath(); ctx.ellipse(3, 0, 4.6, 3.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.cyan; ctx.fillRect(1, -0.6, 6, 1.2);
    // seatpost phone (faces back)
    rr(-16, -3.8, 3, 7.6, 1); ctx.fillStyle = '#0b0e14'; ctx.fill();
    ctx.strokeStyle = COL.cyan; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.restore();

    // LEDs with glow (unscaled)
    const rearX = BX - 18 * BS, hbX = BX + 9 * BS;
    glow(rearX - 6, BIKE_Y, 8 + 22 * ph.rear, '#ff3b30', 0.6 * ph.rear);
    ctx.fillStyle = rgba('#ff3b30', 0.3 + 0.7 * ph.rear); ctx.beginPath(); ctx.arc(rearX, BIKE_Y, 2.4, 0, Math.PI * 2); ctx.fill();
    glow(hbX + 4, BIKE_Y, 6 + 14 * ph.hb, ph.hbCol, 0.55 * ph.hb);
    ctx.fillStyle = rgba(ph.hbCol, 0.35 + 0.65 * ph.hb); ctx.beginPath(); ctx.arc(hbX, BIKE_Y, 2.4, 0, Math.PI * 2); ctx.fill();

    // BLE pulses phone -> handlebar LED while alerting
    if (ph.st === 1 || ph.st === 2) {
      for (let i = 0; i < 2; i++) {
        const k = ((t * 1.6) + i * 0.5) % 1;
        const x = camX() + (hbX - camX()) * k, y = BIKE_Y - 16 - Math.sin(k * Math.PI) * 8;
        ctx.fillStyle = rgba(COL.cyan, 0.9 * Math.sin(k * Math.PI)); ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function tag(str, x, y, color, fg = '#0a0e16', size = 9) {
    ctx.font = `700 ${size}px ${FONT}`;
    const w = ctx.measureText(str).width + 10;
    rr(x - w / 2, y - 8, w, 16, 3); ctx.fillStyle = color; ctx.fill();
    text(str, x, y + 0.5, size, fg, 700, 'center');
  }

  function measure(t, ph, car) {
    const { st, d, ttc } = ph;
    const col = st === 2 ? COL.red : COL.amber;
    if ((st === 1 || st === 2) && car.front < 6) {
      // car still off-screen behind: edge indicator
      tag(`◀ ${d.toFixed(0)}m`, 30, LANE_Y, col);
    } else if (st === 1 || st === 2) {
      const x0 = car.front + 2, x1 = camX() - 4, y = BIKE_Y + 18;
      ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y + 4); ctx.moveTo(x1, y - 4); ctx.lineTo(x1, y + 4); ctx.stroke();
      if (x1 - x0 > 40) tag(`${d.toFixed(1)}m · TTC ${ttc.toFixed(1)}s`, (x0 + x1) / 2, y, col);
      else tag(`TTC ${ttc.toFixed(1)}s`, x1 - 40, y, col);
    }
    if (st === 3 && car.front > BX - 10 && car.front - CAR_L < BX + 10) {
      const y0 = car.y + CAR_W / 2 + 1, y1 = BIKE_Y - 8 * BS;
      ctx.strokeStyle = COL.amber; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(BX - 4, y0); ctx.lineTo(BX + 4, y0); ctx.moveTo(BX, y0); ctx.lineTo(BX, y1); ctx.moveTo(BX - 4, y1); ctx.lineTo(BX + 4, y1); ctx.stroke();
      tag('CPA 1.1m', BX + 40, (y0 + y1) / 2, COL.amber);
    }
  }

  // ---------- zoom windows ----------
  function card(x0, x1, title, sub) {
    rr(x0, INSET_T, x1 - x0, INSET_B - INSET_T, 8);
    ctx.fillStyle = 'rgba(10,14,22,.9)'; ctx.fill();
    ctx.strokeStyle = '#2a313c'; ctx.lineWidth = 1; ctx.stroke();
    const w = text(title, x0 + 10, INSET_T + 13, 9.5, '#dfe2ee', 700);
    if (sub) text(sub, x0 + 16 + w, INSET_T + 13, 8.5, '#869397', 500);
  }
  function leader(x0, y0, x1, y1) {
    ctx.strokeStyle = 'rgba(188,201,205,.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(188,201,205,.8)';
    ctx.beginPath(); ctx.arc(x0, y0, 2, 0, Math.PI * 2); ctx.arc(x1, y1, 2, 0, Math.PI * 2); ctx.fill();
  }

  function insets(t, ph, car) {
    const gap = 12, inner = LW - 32 - gap;
    const rX0 = 16, rX1 = 16 + Math.min(300, inner * 0.6), hX0 = rX1 + gap, hX1 = LW - 16;
    leader(camX(), BIKE_Y + 6, rX1 - 30, INSET_T);
    leader(BX + 9 * BS, BIKE_Y + 6, (hX0 + hX1) / 2, INSET_T);

    // rear unit: smartphone camera view + rear LED
    card(rX0, rX1, '후방 유닛', LW < 520 ? '' : '시트포스트 · 스마트폰 + 후방 LED');
    const top = INSET_T + 26, bot = INSET_B - 10;
    const ledW = 54;
    const availW = rX1 - rX0 - 20 - ledW - 8, availH = bot - top;
    const phH = Math.min(availH, availW * 0.5), phW = phH / 0.5;
    const px = rX0 + 10, py = top + (availH - phH) / 2;
    rr(px, py, phW, phH, 9); ctx.fillStyle = '#05070b'; ctx.fill();
    ctx.strokeStyle = '#3a424e'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#1b2029'; ctx.beginPath(); ctx.arc(px + 4, py + phH / 2, 1.4, 0, Math.PI * 2); ctx.fill();
    feed(t, ph, car, px + 8, py + 5, phW - 13, phH - 10);

    // rear LED (vertical taillight)
    const lx = px + phW + 6 + ledW / 2, lh = Math.min(64, availH - 26), ly = top + 2;
    glow(lx, ly + lh / 2, 18 + 40 * ph.rear, '#ff3b30', 0.55 * ph.rear);
    rr(lx - 11, ly, 22, lh, 10); ctx.fillStyle = '#1a0b0d'; ctx.fill();
    ctx.strokeStyle = '#4a1d22'; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const cy = ly + 10 + i * ((lh - 20) / 3);
      ctx.fillStyle = rgba('#ff3b30', 0.12 + 0.88 * ph.rear); ctx.beginPath(); ctx.arc(lx, cy, 4, 0, Math.PI * 2); ctx.fill();
    }
    text('후방 LED', lx, ly + lh + 10, 8.5, '#dfe2ee', 700, 'center');
    const rm = ph.st === 2 ? '6Hz 고속' : ph.st === 1 || (ph.st === 3 && t < 7.8) ? '2Hz 점멸' : '상시 점등';
    text(rm, lx, ly + lh + 22, 8, ph.st === 2 ? '#ff817a' : '#bcc9cd', 600, 'center');

    // handlebar LED
    card(hX0, hX1, '핸들 LED', LW < 520 ? '' : '라이더 알림');
    const hc = (hX0 + hX1) / 2, hw = hX1 - hX0;
    const msg = ph.st === 0 || (ph.st === 3 && t >= 7.8) ? '안전 · 후방 이상 없음'
      : ph.st === 1 ? `주의 · 후방 차량 ${ph.d.toFixed(0)}m`
      : ph.st === 2 ? `위험 · 급접근 TTC ${ph.ttc.toFixed(1)}s` : '추월 완료 · CPA 1.1m';
    const fs = clamp(hw / 17, 8, 11);
    text(msg, hc, INSET_T + 38, fs, ph.hbCol, 700, 'center');
    // bar + stem
    ctx.save();
    rr(hX0, INSET_T, hw, INSET_B - INSET_T, 8); ctx.clip();
    const barY = INSET_T + 104;
    ctx.strokeStyle = '#15181d'; ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hX0 - 10, barY + 18); ctx.quadraticCurveTo(hc, barY - 12, hX1 + 10, barY + 18); ctx.stroke();
    ctx.strokeStyle = 'rgba(140,155,175,.25)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hX0 - 10, barY + 13); ctx.quadraticCurveTo(hc, barY - 17, hX1 + 10, barY + 13); ctx.stroke();
    ctx.fillStyle = '#101317'; ctx.fillRect(hc - 8, barY, 16, INSET_B - barY);
    // LED pod
    const podW = Math.min(96, hw - 30), podY = INSET_T + 70;
    glow(hc, podY, 30 + 50 * ph.hb, ph.hbCol, 0.45 * ph.hb);
    ctx.fillStyle = '#1a1e24'; ctx.fillRect(hc - 4, podY + 10, 8, barY - podY - 10);
    rr(hc - podW / 2, podY - 11, podW, 22, 11); ctx.fillStyle = '#0b0e14'; ctx.fill();
    ctx.strokeStyle = '#39414d'; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const lxx = hc - podW / 2 + 14 + i * ((podW - 28) / 4);
      ctx.fillStyle = rgba(ph.hbCol, 0.12 + 0.88 * ph.hb); ctx.beginPath(); ctx.arc(lxx, podY, 4.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    const hm = ph.st === 2 ? '빨강 · 6Hz 점멸' : ph.st === 1 || (ph.st === 3 && t < 7.8) ? '주황 · 2Hz 점멸' : '청록 · 상시';
    text(hm, hc, INSET_B - 12, 8, '#bcc9cd', 600, 'center');
  }

  // What the seatpost smartphone camera sees (looking back). No alerts here: the phone is
  // behind the rider, so it only runs detection and drives the LEDs over BLE.
  function feed(t, ph, car, x, y, w, h) {
    const { st, d, ttc } = ph;
    ctx.save();
    rr(x, y, w, h, 6); ctx.clip();
    const hz = y + h * 0.42, vx = x + w * 0.42, f2 = w * 0.55, c2 = 0.9;
    const M = (X, Hh, Z) => [vx + (f2 * X) / Z, hz + (f2 * (c2 - Hh)) / Z];
    let g = ctx.createLinearGradient(0, y, 0, hz);
    g.addColorStop(0, '#141a2e'); g.addColorStop(1, '#4b3b55');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, hz - y);
    ctx.fillStyle = '#0f150f'; ctx.fillRect(x, hz, w, y + h - hz);
    // lateral X (m): + = toward the car lane / centre line
    const lat = (py) => (BIKE_Y - py) / PX;
    const RLf = lat(SHOULDER_B), RRf = lat(ROAD_T);
    poly([M(RLf, 0, 0.25), M(RRf, 0, 0.25), M(RRf, 0, 400), M(RLf, 0, 400)], '#2a2c34');
    const strip = (X, sw, z0, z1, c) => poly([M(X - sw / 2, 0, z0), M(X + sw / 2, 0, z0), M(X + sw / 2, 0, z1), M(X - sw / 2, 0, z1)], c);
    strip(lat(ROAD_B), 0.12, 0.25, 400, 'rgba(225,228,235,.55)');
    strip(lat(ROAD_T + 3), 0.12, 0.25, 400, 'rgba(225,228,235,.4)');
    const off = (V * t) % 10;
    for (let k = -1; k < 25; k++) {
      const z0 = k * 10 + off;
      if (z0 + 3 < 0.25) continue;
      strip(lat(CENTER), 0.14, Math.max(0.25, z0), z0 + 3, 'rgba(233,185,73,.75)');
    }

    if (d > 0.3 && d < 50) {
      const cx = lat(car.y);
      poly([M(cx - 0.7, 0, d), M(cx + 0.7, 0, d), M(cx + 1.8, 0, Math.max(0.3, d - 14)), M(cx - 1.8, 0, Math.max(0.3, d - 14))], 'rgba(255,240,210,.12)');
      const R = (x0, h0, x1, h1, fill) => poly([M(x0, h0, d), M(x1, h0, d), M(x1, h1, d), M(x0, h1, d)], fill);
      R(cx - 0.9, 0.3, cx + 0.9, 0.95, '#2a3341');
      poly([M(cx - 0.78, 0.95, d), M(cx + 0.78, 0.95, d), M(cx + 0.62, 1.4, d), M(cx - 0.62, 1.4, d)], '#0d121b');
      R(cx - 0.4, 0.42, cx + 0.4, 0.58, '#141922');
      for (const lx of [cx - 0.62, cx + 0.62]) {
        const [hx, hy] = M(lx, 0.68, d);
        const rad = Math.max(1.2, (f2 * 0.12) / d);
        glow(hx, hy, rad * 5, '#fffae6', 0.9);
        ctx.beginPath(); ctx.arc(hx, hy, rad, 0, Math.PI * 2); ctx.fillStyle = '#fffbe8'; ctx.fill();
      }
      if (st === 1 || st === 2) {
        const col = st === 2 ? COL.red : COL.amber;
        let [bx0, by0] = M(cx - 1.05, 1.55, d), [bx1, by1] = M(cx + 1.05, 0.15, d);
        const mcx = (bx0 + bx1) / 2, mcy = (by0 + by1) / 2;
        const bw = Math.max(14, bx1 - bx0), bh = Math.max(10, by1 - by0);
        bx0 = mcx - bw / 2; by0 = mcy - bh / 2;
        ctx.fillStyle = rgba(col, 0.12); ctx.fillRect(bx0, by0, bw, bh);
        ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.strokeRect(bx0, by0, bw, bh);
        ctx.font = `700 7.5px ${FONT}`;
        const lw = ctx.measureText('승용차 0.94').width + 6, ly = Math.max(y + 16, by0 - 11);
        ctx.fillStyle = col; ctx.fillRect(bx0, ly, lw, 10);
        text('승용차 0.94', bx0 + 3, ly + 5.5, 7.5, '#0a0e16', 700);
      }
    }

    ctx.fillStyle = 'rgba(5,8,14,.78)'; ctx.fillRect(x, y, w, 13);
    text('● 후방 카메라', x + 5, y + 7, 7.5, COL.cyan, 700);
    text('온디바이스 추론', x + w - 5, y + 7, 7.5, '#869397', 600, 'right');
    ctx.fillStyle = 'rgba(5,8,14,.78)'; ctx.fillRect(x, y + h - 14, w, 14);
    const by = y + h - 6.5;
    if (st === 1 || st === 2) {
      const w1 = text(`d ${d.toFixed(1)}m`, x + 5, by, 8, '#dfe2ee');
      text(`TTC ${ttc.toFixed(1)}s`, x + 14 + w1, by, 8, st === 2 ? '#ff817a' : COL.amber);
    } else if (st === 3) {
      text('CLOSE PASS 기록 · CPA 1.1m', x + 5, by, 8, COL.amber);
    } else {
      text('NO TARGET', x + 5, by, 8, '#869397');
    }
    ctx.restore();
  }

  // ---------- DOM HUD ----------
  const last = {};
  const setText = (k, v) => { if (last[k] !== v) { last[k] = v; el[k].textContent = v; } };
  function hud(t, ph) {
    const { st, d, ttc } = ph;
    setText('state', ['STATE: CLEAR', 'STATE: DETECTED', 'STATE: APPROACHING', 'STATE: PASSED · LOGGED'][st]);
    el.state.style.color = ['#4cd7f6', '#ffb95f', '#ff817a', '#ffb95f'][st];
    setText('track', st === 0 ? 'KALMAN: IDLE' : 'KALMAN: TRACK #042');
    const chip = st === 1 ? [`후방 차량 감지 · ${d.toFixed(0)}m`, 'amber']
      : st === 2 ? [`⚠ 후방 차량 급접근 · TTC ${ttc.toFixed(1)}s`, 'red']
      : st === 3 ? ['WARN: CPA 1.1m (CLOSE PASS)', 'amber'] : null;
    if (chip) { setText('chip', chip[0]); el.chip.dataset.tone = chip[1]; }
    el.chip.style.opacity = chip ? 1 : 0;
    el.vig.style.opacity = st === 2 ? (0.3 + 0.3 * Math.sin(t * Math.PI * 2 * 3)) * sstep(3.8, 4.2, t) : 0;
  }

  // ---------- loop / lifecycle ----------
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function resize() {
    const r = root.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    s = r.height / H;
    if (r.width / s < 400) s = r.width / 400;
    LW = r.width / s;
    ox = 0;
    oy = (r.height - H * s) / 2;
    BX = LW * 0.7;
    frame(reduce.matches ? 5 : t);
  }
  function tick(now) {
    raf = 0;
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    t = (t + dt) % T;
    frame(t);
    schedule();
  }
  function schedule() {
    if (raf || !visible || document.hidden || reduce.matches) { if (!raf) lastNow = 0; return; }
    raf = requestAnimationFrame(tick);
  }

  new ResizeObserver(resize).observe(root);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; schedule(); }).observe(root);
  document.addEventListener('visibilitychange', schedule);
  reduce.addEventListener?.('change', () => { resize(); schedule(); });
  if (document.fonts) document.fonts.ready.then(() => frame(reduce.matches ? 5 : t));

  resize();
  schedule();
})();
