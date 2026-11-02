(() => {
  'use strict';
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = id => document.getElementById(id);
  const ui = {
    start: $('start-overlay'), pause: $('pause-overlay'), finish: $('finish-overlay'), startButton: $('start-button'), resume: $('resume-button'), restart: $('restart-button'),
    speed: $('speed'), gear: $('gear'), meter: $('speed-meter'), score: $('score'), passengers: $('passengers'), clock: $('clock'), progress: $('progress-fill'), distance: $('distance-label'),
    status: $('status-pill'), notice: $('notice'), noticeText: $('notice-text'), tip: $('tip'), sound: $('sound-button'), soundIcon: $('sound-icon'),
    finalScore: $('final-score'), finalPassengers: $('final-passengers'), finalTime: $('final-time'), finishTitle: $('finish-title'), finishCopy: $('finish-copy')
  };
  const routeLength = 1420;
  const stops = [360, 820, 1190];
  const traffic = [
    { z: 145, lane: -.48, kind: 'jeep', speed: 20 }, { z: 285, lane: .47, kind: 'truck', speed: 29 },
    { z: 525, lane: .1, kind: 'bus', speed: 26 }, { z: 675, lane: -.52, kind: 'jeep', speed: 31 },
    { z: 940, lane: .52, kind: 'truck', speed: 25 }, { z: 1070, lane: -.12, kind: 'jeep', speed: 32 },
    { z: 1290, lane: .45, kind: 'bus', speed: 27 }
  ];
  let W = 0, H = 0, dpr = 1, state = 'intro', last = 0, elapsed = 0, distance = 0, speed = 0, lateral = 0, steer = 0, score = 0, passengers = 0;
  let shake = 0, noticeTimer = 0, soundOn = false, audioCtx = null, lastCrash = -10;
  let pickedStops = [0, 0, 0];
  const keys = new Set(), touch = { left: false, right: false, accelerate: false, brake: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const curve = z => .0008 * Math.sin(z / 105) + .0021 * Math.sin((z - 250) / 230) + .0042 * Math.exp(-(((z - 570) / 170) ** 2)) - .0035 * Math.exp(-(((z - 1010) / 220) ** 2)) + .004 * Math.exp(-(((z - 1280) / 150) ** 2));
  const roadStep = 5, roadTable = [0];
  for (let p = 0; p < 2600; p += roadStep) roadTable.push(roadTable[roadTable.length - 1] + curve(p + roadStep / 2) * roadStep);
  function roadOffset(z) {
    const pos = clamp(z, 0, (roadTable.length - 1) * roadStep) / roadStep;
    const index = Math.floor(pos);
    return lerp(roadTable[index], roadTable[Math.min(index + 1, roadTable.length - 1)], pos - index);
  }
  let cameraRoad = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize); resize();
  function formatTime(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; }
  function announce(text, duration = 2.4) { ui.noticeText.textContent = text; ui.notice.classList.add('show'); noticeTimer = duration; }
  function reset() {
    elapsed = distance = speed = lateral = steer = score = passengers = 0; shake = 0; lastCrash = -10; pickedStops = [0, 0, 0]; cameraRoad = 0;
    traffic.forEach((car, i) => { car.hit = false; car.z = [145, 285, 525, 675, 940, 1070, 1290][i]; });
    ui.progress.style.width = '0%'; ui.score.textContent = '0000'; ui.passengers.textContent = '0 / 3 passengers'; ui.clock.textContent = '00:00';
    ui.status.textContent = 'EN ROUTE'; ui.distance.textContent = '0.0 km'; ui.start.classList.add('hidden'); ui.pause.classList.add('hidden'); ui.finish.classList.add('hidden');
    state = 'playing'; last = performance.now();
  }
  function pause() { if (state !== 'playing') return; state = 'paused'; ui.pause.classList.remove('hidden'); }
  function resume() { if (state !== 'paused') return; state = 'playing'; ui.pause.classList.add('hidden'); last = performance.now(); }
  function finish() {
    state = 'finished'; ui.status.textContent = 'ARRIVED'; ui.finishTitle.textContent = passengers === 3 ? 'Namaste, driver.' : 'You made it, driver.';
    ui.finishCopy.textContent = passengers === 3 ? 'Every passenger made it safely. The mountains thank you.' : 'The road to Pokhara is behind you. Come back for the full route next time.';
    ui.finalScore.textContent = String(Math.round(score)).padStart(4, '0'); ui.finalPassengers.textContent = `${passengers}/3`; ui.finalTime.textContent = formatTime(elapsed);
    ui.finish.classList.remove('hidden');
  }
  function update(dt) {
    if (state !== 'playing') return;
    elapsed += dt;
    const left = keys.has('ArrowLeft') || keys.has('a') || keys.has('A') || touch.left;
    const right = keys.has('ArrowRight') || keys.has('d') || keys.has('D') || touch.right;
    const accel = keys.has('ArrowUp') || keys.has('w') || keys.has('W') || touch.accelerate;
    const brake = keys.has('ArrowDown') || keys.has('s') || keys.has('S') || keys.has(' ') || touch.brake;
    const targetSteer = (right ? 1 : 0) - (left ? 1 : 0);
    steer = lerp(steer, targetSteer, 1 - Math.exp(-dt * 7));
    speed += (accel ? 34 : -7) * dt;
    if (brake) speed -= 73 * dt;
    speed = clamp(speed, 0, 112);
    const bend = curve(distance);
    lateral += (steer * (0.65 + speed / 90) - bend * speed * .42) * dt;
    lateral *= Math.exp(-dt * (speed < 4 ? 1.8 : .24));
    distance += speed / 3.6 * dt * 2.35;
    cameraRoad = roadOffset(distance);
    const offroad = Math.abs(lateral) > 1.02;
    if (offroad) { speed = Math.max(12, speed - 28 * dt); score = Math.max(0, score - 5 * dt); }
    else if (speed > 15 && speed < 68) score += dt * (1.4 + (passengers * .35));
    else if (speed >= 68 && speed < 88) score += dt * .45;
    if (speed > 90) score = Math.max(0, score - 2 * dt);
    stops.forEach((z, i) => {
      if (pickedStops[i]) return;
      if (distance > z - 28 && distance < z + 24 && speed < 19) {
        pickedStops[i] = 1; passengers++; score += 150;
        announce(['Auntie and her basket are aboard!', 'A school teacher joins the ride!', 'Last passenger picked up — Pokhara bound!'][i], 3);
        ui.passengers.textContent = `${passengers} / 3 passengers`;
      } else if (distance >= z + 24) {
        pickedStops[i] = -1; announce('Missed the stop — watch for the next one.', 2.1);
      }
    });
    traffic.forEach(car => {
      if (car.hit) return;
      if (Math.abs(car.z - distance) < 11 && Math.abs(lateral - car.lane) < .43) {
        car.hit = true; speed = Math.max(8, speed * .42); lateral += (lateral < car.lane ? -.24 : .24); score = Math.max(0, score - 80); shake = .42; lastCrash = elapsed;
        announce('Easy there! Watch your distance.', 2.2); if (soundOn) honk();
      }
    });
    shake = Math.max(0, shake - dt);
    if (noticeTimer > 0) { noticeTimer -= dt; if (noticeTimer <= 0) ui.notice.classList.remove('show'); }
    if (Math.floor(elapsed) % 18 === 0 && Math.floor(elapsed) !== 0 && elapsed - Math.floor(elapsed) < dt) announce('The mountain bends are beautiful. Keep your speed down.', 2.6);
    ui.speed.textContent = String(Math.round(speed)).padStart(2, '0'); ui.gear.textContent = speed < 1 ? 'N' : speed < 23 ? '1' : speed < 43 ? '2' : speed < 67 ? '3' : '4';
    ui.meter.style.width = `${Math.min(100, speed / 112 * 100)}%`; ui.score.textContent = String(Math.round(score)).padStart(4, '0');
    ui.clock.textContent = formatTime(elapsed); ui.progress.style.width = `${Math.min(100, distance / routeLength * 100)}%`; ui.distance.textContent = `${(distance / routeLength * 142).toFixed(1)} km`;
    $('speed-note').textContent = offroad ? 'Off the road!' : speed > 88 ? 'Slow down for safety' : speed > 68 ? 'Watch the bends' : 'Drive carefully';
    if (distance >= routeLength) finish();
  }
  function polygon(points, fill, stroke, lineWidth = 1) {
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]); for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function line(points, color, width = 1) { ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]); for (let i=1;i<points.length;i++) ctx.lineTo(points[i][0], points[i][1]); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.stroke(); }
  function projection(z) { const horizon = H * .405, depth = Math.max(0, z); const p = 1 / (1 + depth / 125); return { p, y: horizon + (H * .61) * p }; }
  function centerAt(z, p) { return W * .5 + (roadOffset(Math.max(0, distance + z)) - cameraRoad) * W * .19 * p; }
  function drawMountains() {
    const horizon = H * .405;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + 40); sky.addColorStop(0, '#78b7ca'); sky.addColorStop(.58, '#b8d5d5'); sky.addColorStop(1, '#f2d4b0'); ctx.fillStyle = sky; ctx.fillRect(0,0,W,horizon+42);
    const sun = ctx.createRadialGradient(W*.76,H*.17,2,W*.76,H*.17,100); sun.addColorStop(0,'rgba(255,235,195,.8)');sun.addColorStop(1,'rgba(255,235,195,0)');ctx.fillStyle=sun;ctx.fillRect(W*.76-110,H*.17-110,220,220);
    ctx.fillStyle='#f9edce';ctx.beginPath();ctx.arc(W*.76,H*.17,15,0,Math.PI*2);ctx.fill();
    for (let layer=0;layer<3;layer++) {
      const base = horizon + layer*24, amp = [95,72,48][layer], step=46;
      ctx.beginPath();ctx.moveTo(0,H);ctx.lineTo(0,base);
      for(let x=0;x<=W+step;x+=step){const q=x/step+layer*7;const y=base-amp*(.48+.5*Math.sin(q*1.12)+.28*Math.sin(q*.41+1.3));ctx.lineTo(x,y);}
      ctx.lineTo(W,H);ctx.closePath();ctx.fillStyle=['#7b9d9f','#617f7b','#4a6861'][layer];ctx.fill();
      if(layer===0){for(let x=20;x<W;x+=step*2){const y=base-amp*(.48+.5*Math.sin((x/step+layer*7)*1.12)+.28*Math.sin((x/step+layer*7)*.41+1.3));polygon([[x-22,y+17],[x,y-25],[x+24,y+18]],'rgba(239,240,221,.62)');}}
    }
    const ground = ctx.createLinearGradient(0,horizon,0,H);ground.addColorStop(0,'#527c66');ground.addColorStop(1,'#294d43');ctx.fillStyle=ground;ctx.fillRect(0,horizon,W,H-horizon);
    // High valley haze and distant terraced hills
    for(let i=0;i<5;i++){const y=horizon+40+i*17;ctx.fillStyle=`rgba(216,207,166,${.045-i*.005})`;ctx.fillRect(0,y,W,11);}
  }
  function segment(z, z2, color) {
    const a=projection(z), b=projection(z2); if(a.y>=H+2||b.y<0)return;
    const ca=centerAt(z,a.p), cb=centerAt(z2,b.p), wa=W*(.34*a.p+.012), wb=W*(.34*b.p+.012);
    const shoulderA=wa*1.2, shoulderB=wb*1.2;
    polygon([[cb-shoulderB,b.y],[cb+shoulderB,b.y],[ca+shoulderA,a.y],[ca-shoulderA,a.y]], (Math.floor((distance+z)/22)%2?'#b9a886':'#c7b596'));
    polygon([[cb-wb,b.y],[cb+wb,b.y],[ca+wa,a.y],[ca-wa,a.y]], color);
    // alternating edge posts
    if(Math.floor((distance+z)/28)%2===0){const rw=wa*.075;polygon([[ca-wa-rw,a.y],[ca-wa,a.y],[cb-wb,b.y],[cb-wb-rw,b.y]],'#e5dfc8');polygon([[ca+wa,a.y],[ca+wa+rw,a.y],[cb+wb+rw,b.y],[cb+wb,b.y]],'#e5dfc8');}
    if(Math.floor((distance+z)/36)%2===0){const mark=wa*.025;polygon([[cb-mark,b.y],[cb+mark,b.y],[ca+mark,a.y],[ca-mark,a.y]],'rgba(244,228,185,.62)');}
    // outer road edge safety paint
    const edge=wa*.018;polygon([[ca-wa,a.y],[ca-wa+edge,a.y],[cb-wb+edge,b.y],[cb-wb,b.y]],'#eee6ce');polygon([[ca+wa-edge,a.y],[ca+wa,a.y],[cb+wb,b.y],[cb+wb-edge,b.y]],'#eee6ce');
  }
  function drawTree(x,y,s,kind=0) {
    if(y>H+30||y<H*.4)return;
    if(kind===1){ctx.fillStyle='#55483b';ctx.fillRect(x-s*.09,y-s*.45,s*.18,s*.45);polygon([[x-s*.47,y-s*.36],[x,y-s],[x+s*.47,y-s*.36]],'#456859');polygon([[x-s*.38,y-s*.56],[x,y-s*1.15],[x+s*.38,y-s*.56]],'#4e7662');}
    else {ctx.fillStyle='#685445';ctx.fillRect(x-s*.065,y-s*.46,s*.13,s*.46);ctx.fillStyle='#376854';ctx.beginPath();ctx.arc(x,y-s*.59,s*.34,0,Math.PI*2);ctx.fill();ctx.fillStyle='#548267';ctx.beginPath();ctx.arc(x-s*.19,y-s*.55,s*.21,0,Math.PI*2);ctx.fill();}
  }
  function drawHouse(x,y,s,idx) {
    if(y>H+40||y<H*.43)return;
    const ww=s*(.75+(idx%3)*.14), hh=s*.52;
    ctx.fillStyle='#b68760';ctx.fillRect(x-ww/2,y-hh,ww,hh);
    polygon([[x-ww*.62,y-hh],[x,y-hh-s*.34],[x+ww*.62,y-hh]],idx%2?'#7b5140':'#914e3b');
    ctx.fillStyle='#4a3930';ctx.fillRect(x-ww*.08,y-hh*.48,ww*.16,hh*.48);
    ctx.fillStyle='#94c4c1';ctx.fillRect(x-ww*.35,y-hh*.72,ww*.16,hh*.17);ctx.fillRect(x+ww*.2,y-hh*.72,ww*.16,hh*.17);
  }
  function drawFlags(x,y,s) {
    line([[x,y],[x,y-s*.8],[x+s*.8,y-s*.66]],'#594b3d',Math.max(1,s*.035));
    const colors=['#dd5c4d','#e3c04f','#3d8e6e','#4e74ab','#eee3c5'];
    for(let i=0;i<5;i++){ctx.fillStyle=colors[i];ctx.globalAlpha=.88;ctx.beginPath();ctx.moveTo(x,y-s*.79+i*s*.1);ctx.lineTo(x+s*.19,y-s*.72+i*s*.1);ctx.lineTo(x+s*.38,y-s*.79+i*s*.1);ctx.lineTo(x+s*.19,y-s*.69+i*s*.1);ctx.closePath();ctx.fill();}ctx.globalAlpha=1;
  }
  function roadPoint(z,lane=0){const pr=projection(z);return {x:centerAt(z,pr.p)+lane*W*(.34*pr.p+.012),y:pr.y,p:pr.p};}
  function drawDecor() {
    const start=Math.floor(distance/55)*55;
    for(let z=start-distance;z<850;z+=55){if(z<12)continue;const world=Math.floor((distance+z)/55), pr=projection(z), c=centerAt(z,pr.p), half=W*(.34*pr.p+.012);const s=clamp(pr.p*80,2,68);
      if(world%7===1){drawFlags(c-half*1.22,pr.y,s*.55);}
      if(world%6===2){drawHouse(c+half*(1.55+(world%2)*.24),pr.y,s*.72,world);}
      else drawTree(c+half*(1.32+(world%3)*.1),pr.y,s,world%3===0?1:0);
      if(world%5===0)drawTree(c-half*(1.35+(world%2)*.1),pr.y,s*.86,world%4===0?1:0);
      if(world%13===4){ctx.fillStyle='#eee6d4';ctx.fillRect(c-half*1.13,pr.y-s*.55,s*.13,s*.55);ctx.fillStyle='#cc6850';ctx.fillRect(c-half*1.15,pr.y-s*.6,s*.17,s*.12);}
    }
    stops.forEach((z,i)=>{const rel=z-distance;if(rel<0||rel>700)return;const p=roadPoint(rel,-.77);drawHouse(p.x-W*p.p*.09,p.y,W*p.p*.13,i);const sign=roadPoint(rel,.75);ctx.fillStyle='#263f3d';ctx.fillRect(sign.x,sign.y-W*p.p*.11,W*p.p*.19,W*p.p*.09);ctx.fillStyle='#f4ddaa';ctx.font=`${Math.max(5,W*p.p*.024)}px DM Mono,monospace`;ctx.textAlign='center';ctx.fillText('BUS STOP',sign.x+W*p.p*.095,sign.y-W*p.p*.055);});
  }
  function drawOtherVehicle(car) {
    const rel=car.z-distance;if(rel<-5||rel>780||car.hit)return;
    const pos=roadPoint(rel,car.lane), s=clamp(pos.p*98,5,75), w=s*(car.kind==='bus'?.78:car.kind==='truck'?.65:.63), h=s*(car.kind==='bus'?.96:car.kind==='truck'?.86:.72);
    ctx.save();ctx.translate(pos.x,pos.y);
    ctx.fillStyle='rgba(20,25,24,.25)';ctx.beginPath();ctx.ellipse(0,0,w*.68,s*.11,0,0,Math.PI*2);ctx.fill();
    const body=car.kind==='bus'?'#d9b752':car.kind==='truck'?'#a56b51':'#688d82';
    ctx.fillStyle='#282c29';ctx.fillRect(-w*.42,-h*.32,w*.16,h*.34);ctx.fillRect(w*.26,-h*.32,w*.16,h*.34);
    ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(-w*.48,-h*.18);ctx.lineTo(-w*.39,-h*.71);ctx.quadraticCurveTo(0,-h*.88,w*.39,-h*.71);ctx.lineTo(w*.48,-h*.18);ctx.closePath();ctx.fill();
    ctx.fillStyle='#a8c6c1';ctx.beginPath();ctx.moveTo(-w*.31,-h*.67);ctx.quadraticCurveTo(0,-h*.77,w*.31,-h*.67);ctx.lineTo(w*.32,-h*.42);ctx.lineTo(-w*.32,-h*.42);ctx.closePath();ctx.fill();
    ctx.fillStyle='#f3e8c8';ctx.fillRect(-w*.4,-h*.22,w*.18,h*.07);ctx.fillRect(w*.22,-h*.22,w*.18,h*.07);
    ctx.fillStyle='#bf4e3e';ctx.fillRect(-w*.4,-h*.18,w*.12,h*.08);ctx.fillRect(w*.28,-h*.18,w*.12,h*.08);
    ctx.restore();
  }
  function drawPlayerBus() {
    const x=W*.5+lateral*W*.34, y=H*.88, scale=clamp(Math.min(W/1000,H/650),.68,1.05), w=170*scale, h=196*scale;
    ctx.save();ctx.translate(x,y);ctx.rotate(-steer*.035);ctx.scale(1+shake*.035,1-shake*.025);
    ctx.fillStyle='rgba(13,20,19,.4)';ctx.beginPath();ctx.ellipse(0,5,w*.8,20*scale,0,0,Math.PI*2);ctx.fill();
    // Wheels and detailed body silhouette
    ctx.fillStyle='#242b2a';ctx.fillRect(-w*.51,-h*.53,w*.15,h*.37);ctx.fillRect(w*.36,-h*.53,w*.15,h*.37);
    ctx.fillStyle='#353b39';ctx.fillRect(-w*.52,-h*.23,w*.16,h*.32);ctx.fillRect(w*.36,-h*.23,w*.16,h*.32);
    const body=ctx.createLinearGradient(-w*.52,0,w*.48,0);body.addColorStop(0,'#a74732');body.addColorStop(.24,'#d56841');body.addColorStop(.54,'#f1a05d');body.addColorStop(1,'#bb5338');
    ctx.fillStyle=body;ctx.beginPath();ctx.moveTo(-w*.48,-h*.12);ctx.lineTo(-w*.44,-h*.76);ctx.quadraticCurveTo(-w*.41,-h*.89,-w*.22,-h*.9);ctx.lineTo(w*.27,-h*.9);ctx.quadraticCurveTo(w*.44,-h*.88,w*.47,-h*.72);ctx.lineTo(w*.49,-h*.12);ctx.quadraticCurveTo(0,-h*.04,-w*.48,-h*.12);ctx.fill();
    // roof rack and luggage
    ctx.fillStyle='#553e31';ctx.fillRect(-w*.38,-h*.97,w*.76,h*.045);ctx.fillStyle='#8b5840';ctx.fillRect(-w*.29,-h*1.03,w*.21,h*.08);ctx.fillStyle='#d5ad68';ctx.fillRect(-w*.04,-h*1.04,w*.27,h*.09);ctx.fillStyle='#477567';ctx.fillRect(w*.24,-h*1.01,w*.12,h*.07);
    // windows
    ctx.fillStyle='#24434a';ctx.beginPath();ctx.moveTo(-w*.36,-h*.75);ctx.lineTo(-w*.31,-h*.85);ctx.quadraticCurveTo(0,-h*.87,w*.31,-h*.84);ctx.lineTo(w*.36,-h*.73);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(225,234,222,.43)';ctx.lineWidth=1*scale;for(let i=0;i<4;i++){const wx=-w*.26+i*w*.17;ctx.strokeRect(wx,-h*.65,w*.13,h*.2);ctx.fillStyle='rgba(240,219,169,.78)';ctx.beginPath();ctx.arc(wx+w*.065,-h*.57,2.4*scale,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#f1c96e';ctx.fillRect(-w*.07,-h*.79,w*.14,h*.04);ctx.fillStyle='#3d2922';ctx.font=`bold ${8*scale}px DM Mono,monospace`;ctx.textAlign='center';ctx.fillText('नेपाल',0,-h*.755);
    // ornamental stripe and front grille
    ctx.fillStyle='#f6d69b';ctx.fillRect(-w*.45,-h*.39,w*.9,h*.045);ctx.fillStyle='#f2b86e';ctx.fillRect(-w*.47,-h*.29,w*.94,h*.025);
    ctx.fillStyle='#46362d';ctx.fillRect(-w*.14,-h*.24,w*.28,h*.13);ctx.fillStyle='#b8aa89';for(let i=0;i<4;i++)ctx.fillRect(-w*.115,-h*.225+i*h*.027,w*.23,h*.009);
    ctx.fillStyle='#fff0c7';ctx.fillRect(-w*.4,-h*.22,w*.17,h*.075);ctx.fillRect(w*.23,-h*.22,w*.17,h*.075);
    ctx.fillStyle='#d84f39';ctx.fillRect(-w*.4,-h*.13,w*.13,h*.07);ctx.fillRect(w*.27,-h*.13,w*.13,h*.07);
    ctx.fillStyle='#372c25';ctx.fillRect(-w*.16,-h*.1,w*.32,h*.035);ctx.fillStyle='#e2d6c1';ctx.font=`${7*scale}px DM Mono,monospace`;ctx.fillText('BA 2 KHA 2026',0,-h*.073);
    // mirrors
    ctx.fillStyle='#362e28';ctx.fillRect(-w*.55,-h*.71,w*.09,h*.055);ctx.fillRect(w*.46,-h*.71,w*.09,h*.055);
    // tiny Nepal flag on the roof
    ctx.fillStyle='#b83231';ctx.beginPath();ctx.moveTo(w*.36,-h*.98);ctx.lineTo(w*.47,-h*.92);ctx.lineTo(w*.36,-h*.87);ctx.lineTo(w*.45,-h*.83);ctx.lineTo(w*.36,-h*.83);ctx.closePath();ctx.fill();ctx.strokeStyle='#e6c261';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(w*.35,-h*.99);ctx.lineTo(w*.35,-h*.8);ctx.stroke();
    ctx.restore();
  }
  function drawFrame() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake * 9, (Math.random() - .5) * shake * 6);
    drawMountains();
    for (let z = 960; z >= 0; z -= 12) {
      const band = Math.floor((distance + z) / 42) % 2;
      segment(z, z + 12, band ? '#454b49' : '#4b514e');
    }
    drawDecor();
    traffic.slice().sort((a, b) => b.z - a.z).forEach(drawOtherVehicle);
    for (let z = 24; z < 720; z += 48) {
      const p = roadPoint(z, -1.08), s = Math.max(1, p.p * 5);
      ctx.fillStyle = 'rgba(230,220,192,.65)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, s, s * .55, 0, 0, Math.PI * 2); ctx.fill();
    }
    drawPlayerBus();
    const shade = ctx.createLinearGradient(0, H * .48, 0, H);
    shade.addColorStop(0, 'rgba(10,22,25,0)'); shade.addColorStop(1, 'rgba(8,18,19,.14)');
    ctx.fillStyle = shade; ctx.fillRect(0, H * .48, W, H * .52);
    ctx.restore();
  }
  function tone(frequency, duration, type = 'sine', volume = .035) {
    if (!soundOn) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = type; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
      osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration);
    } catch (_) { /* Audio is an optional enhancement. */ }
  }
  function honk() { tone(210, .2, 'square', .045); }
  function frame(now) {
    const dt = Math.min(.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    drawFrame();
    requestAnimationFrame(frame);
  }
  function setTouch(name, active) {
    if (name in touch) touch[name] = active;
  }
  ui.startButton.addEventListener('click', reset);
  ui.restart.addEventListener('click', reset);
  ui.resume.addEventListener('click', resume);
  $('pause-chip').addEventListener('click', () => state === 'paused' ? resume() : pause());
  ui.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    ui.sound.classList.toggle('sound-on', soundOn);
    ui.soundIcon.textContent = soundOn ? '♫' : '♪';
    ui.sound.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Enable sound');
    if (soundOn) tone(520, .12, 'sine', .025);
  });
  window.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(event.key)) event.preventDefault();
    if (event.key === 'Escape' || event.key.toLowerCase() === 'p') { state === 'paused' ? resume() : pause(); return; }
    if (event.key === 'Enter' && state === 'intro') reset();
    if (event.key.toLowerCase() === 'r' && (state === 'finished' || state === 'paused')) reset();
    keys.add(event.key);
  });
  window.addEventListener('keyup', event => keys.delete(event.key));
  window.addEventListener('blur', () => { keys.clear(); Object.keys(touch).forEach(k => touch[k] = false); });
  document.querySelectorAll('[data-control]').forEach(button => {
    const control = button.dataset.control;
    const release = event => { if (event) event.preventDefault(); setTouch(control, false); button.classList.remove('pressed'); };
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); setTouch(control, true); button.classList.add('pressed');
      try { button.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is optional. */ }
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  requestAnimationFrame(now => { last = now; frame(now); });
})();
