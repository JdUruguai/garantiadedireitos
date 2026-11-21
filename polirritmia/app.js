/* Polirritmia — metrônomo de duas camadas (Web Audio API, sem dependências). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MIN_PULSOS = 1;
  const MAX_PULSOS = 16;
  const MIN_BPM = 30;
  const MAX_BPM = 240;
  const PRESETS = [[3, 2], [2, 3], [4, 3], [3, 4], [5, 4], [5, 3], [5, 2], [7, 4]];
  const CHAVE_STORAGE = 'polirritmia:v1';

  const gcd = (x, y) => (y ? gcd(y, x % y) : x);
  const lcm = (x, y) => (x * y) / gcd(x, y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ------------------------------------------------------------------ */
  /* Estado                                                              */
  /* ------------------------------------------------------------------ */
  const st = {
    a: 3, b: 2, bpm: 80, ref: 'b',
    somA: 'clave', somB: 'bumbo', volA: 80, volB: 85,
    muteA: false, muteB: false,
    sub: false, acento: true, contagem: false, somToque: true,
    ciclosEtapa: 4, incBpm: 5,
  };

  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_STORAGE) || 'null');
    if (salvo && typeof salvo === 'object') {
      for (const k of Object.keys(st)) if (k in salvo && typeof salvo[k] === typeof st[k]) st[k] = salvo[k];
    }
  } catch (_) { /* sem armazenamento: segue com o padrão */ }
  st.a = clamp(st.a | 0, MIN_PULSOS, MAX_PULSOS);
  st.b = clamp(st.b | 0, MIN_PULSOS, MAX_PULSOS);
  st.bpm = clamp(st.bpm | 0, MIN_BPM, MAX_BPM);

  function salvar() {
    try { localStorage.setItem(CHAVE_STORAGE, JSON.stringify(st)); } catch (_) { /* ignora */ }
  }

  function duracaoCiclo(a, b, bpm, ref) {
    const pulso = 60 / bpm;
    if (ref === 'a') return pulso * a;
    if (ref === 'b') return pulso * b;
    return pulso;
  }

  /* ------------------------------------------------------------------ */
  /* Áudio                                                               */
  /* ------------------------------------------------------------------ */
  let ac = null;
  let master = null;
  let ruido = null;

  function garantirAudio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC({ latencyHint: 'interactive' });
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(comp);
      comp.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 0.5);
      ruido = ac.createBuffer(1, len, ac.sampleRate);
      const d = ruido.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function envelope(g, t, pico, ataque, queda) {
    const p = Math.max(pico, 0.0002);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ataque + queda);
  }

  function osc(tipo, freq, t, dur, pico, ataque, queda, freqFim) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, t);
    if (freqFim) o.frequency.exponentialRampToValueAtTime(freqFim, t + dur);
    envelope(g, t, pico, ataque, queda);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + ataque + queda + 0.02);
    return g;
  }

  function ruidoFiltrado(t, filtro, freq, q, pico, queda) {
    const src = ac.createBufferSource();
    src.buffer = ruido;
    const f = ac.createBiquadFilter();
    f.type = filtro;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    envelope(g, t, pico, 0.001, queda);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + queda + 0.03);
  }

  function tocarSom(tipo, t, vol, acento) {
    if (!ac || vol <= 0) return;
    const v = vol * (acento ? 1 : 0.7);
    switch (tipo) {
      case 'clave':
        osc('sine', acento ? 2500 : 2000, t, 0.05, v * 0.9, 0.001, 0.06);
        osc('triangle', acento ? 1250 : 1000, t, 0.05, v * 0.25, 0.001, 0.04);
        break;
      case 'bumbo':
        osc('sine', acento ? 170 : 150, t, 0.16, v * 1.3, 0.002, 0.34, 42);
        ruidoFiltrado(t, 'lowpass', 1200, 0.7, v * 0.25, 0.015);
        break;
      case 'caixa':
        ruidoFiltrado(t, 'bandpass', 2400, 0.6, v * 0.9, 0.15);
        osc('triangle', 210, t, 0.08, v * 0.55, 0.001, 0.09, 160);
        break;
      case 'conga':
        osc('sine', acento ? 400 : 340, t, 0.2, v * 1.0, 0.002, 0.24, acento ? 380 : 320);
        osc('triangle', acento ? 800 : 680, t, 0.04, v * 0.15, 0.001, 0.03);
        break;
      case 'cowbell': {
        const f = acento ? 1.12 : 1;
        osc('square', 587 * f, t, 0.2, v * 0.22, 0.001, 0.22);
        osc('square', 845 * f, t, 0.2, v * 0.22, 0.001, 0.22);
        break;
      }
      case 'bip':
        osc('square', acento ? 1320 : 880, t, 0.04, v * 0.3, 0.001, 0.05);
        break;
      case 'chimbal':
        ruidoFiltrado(t, 'highpass', 7000, 0.8, v * 0.6, 0.035);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Agendador (lookahead)                                               */
  /* ------------------------------------------------------------------ */
  let tocando = false;
  let timer = null;
  let agendado = null;   // ciclo que está sendo agendado
  let ciclos = [];       // ciclos recentes, para o desenho
  let numCiclo = 0;
  let contagemRestante = 0;

  const pratica = { on: false, etapa: 0, cicloNaEtapa: 0, ultimaVariacao: 'ab' };
  const ETAPAS = [
    { mA: false, mB: true, sub: false },
    { mA: true, mB: false, sub: false },
    { mA: false, mB: false, sub: true },
    { mA: false, mB: false, sub: false },
    null, // varie: sorteado a cada ciclo
  ];

  function sortearVariacao() {
    const opcoes = ['ab', 'ab', 'a', 'b', '0'];
    let v;
    do { v = opcoes[Math.floor(Math.random() * opcoes.length)]; } while (v === '0' && pratica.ultimaVariacao === '0');
    pratica.ultimaVariacao = v;
    return v;
  }

  function novoCiclo(inicio) {
    const a = st.a;
    const b = st.b;
    const c = {
      inicio,
      dur: duracaoCiclo(a, b, st.bpm, st.ref),
      a, b, L: lcm(a, b),
      prox: 0,
      idx: 0,
      contagem: false,
      forcado: false,
      mA: false, mB: false, sub: false,
      etapa: -1, cicloNaEtapa: 0, variacao: null,
    };

    if (contagemRestante > 0) {
      contagemRestante--;
      c.contagem = true;
      c.forcado = true;
      c.mA = true;
      c.mB = true;
    } else {
      c.idx = ++numCiclo;
      if (pratica.on) {
        c.forcado = true;
        c.etapa = pratica.etapa;
        c.cicloNaEtapa = pratica.cicloNaEtapa;
        const cfg = ETAPAS[pratica.etapa];
        if (cfg) {
          c.mA = cfg.mA; c.mB = cfg.mB; c.sub = cfg.sub;
        } else {
          c.variacao = sortearVariacao();
          c.mA = !(c.variacao === 'ab' || c.variacao === 'a');
          c.mB = !(c.variacao === 'ab' || c.variacao === 'b');
        }
        pratica.cicloNaEtapa++;
        if (pratica.cicloNaEtapa >= st.ciclosEtapa) {
          pratica.cicloNaEtapa = 0;
          pratica.etapa++;
          if (pratica.etapa >= ETAPAS.length) {
            pratica.etapa = 0;
            if (st.incBpm > 0) {
              st.bpm = clamp(st.bpm + st.incBpm, MIN_BPM, MAX_BPM);
              renderizarUI();
            }
          }
        }
      }
    }

    ciclos.push(c);
    if (ciclos.length > 5) ciclos.shift();
    return c;
  }

  const mudoA = (c) => (c && c.forcado ? c.mA : st.muteA);
  const mudoB = (c) => (c && c.forcado ? c.mB : st.muteB);
  const comGrade = (c) => (c && c.forcado ? c.sub : st.sub);

  function tocarPasso(c, i, t) {
    const batA = i % (c.L / c.a) === 0;
    const batB = i % (c.L / c.b) === 0;
    if (c.contagem) {
      if (batB) tocarSom('bip', t, 0.55, i === 0);
      return;
    }
    const acento = st.acento && i === 0;
    if (batA && !mudoA(c)) tocarSom(st.somA, t, st.volA / 100, acento);
    if (batB && !mudoB(c)) tocarSom(st.somB, t, st.volB / 100, acento);
    if (comGrade(c)) tocarSom('chimbal', t, batA || batB ? 0.35 : 0.28, false);
  }

  function agendar() {
    if (!tocando || !agendado) return;
    const janela = document.hidden ? 1.2 : 0.12;
    const limite = ac.currentTime + janela;
    for (let guarda = 0; guarda < 2000; guarda++) {
      const c = agendado;
      const t = c.inicio + (c.prox * c.dur) / c.L;
      if (t > limite) break;
      tocarPasso(c, c.prox, t);
      c.prox++;
      if (c.prox >= c.L) agendado = novoCiclo(c.inicio + c.dur);
    }
  }

  function iniciar() {
    garantirAudio();
    tocando = true;
    numCiclo = 0;
    ciclos = [];
    contagemRestante = st.contagem ? 1 : 0;
    if (pratica.on) { pratica.etapa = 0; pratica.cicloNaEtapa = 0; }
    agendado = novoCiclo(ac.currentTime + 0.1);
    agendar();
    clearInterval(timer);
    timer = setInterval(agendar, 25);
    ultimoCiclo = null;
    ultimoPasso = -1;
    renderizarUI();
  }

  function parar() {
    tocando = false;
    clearInterval(timer);
    timer = null;
    agendado = null;
    ciclos = [];
    ultimoCiclo = null;
    ultimoPasso = -1;
    pratica.on = false;
    renderizarUI();
    atualizarPratica(null);
    marcarFrase(-1);
    $('cntA').textContent = '–';
    $('cntB').textContent = '–';
    $('cntCiclo').textContent = '0';
    sujo = true;
  }

  // Mudança de andamento vale na hora: reescala o ciclo em agendamento mantendo o próximo passo no lugar.
  function aplicarAndamentoAoVivo() {
    if (!tocando || !agendado) return;
    const c = agendado;
    const novaDur = duracaoCiclo(c.a, c.b, st.bpm, st.ref);
    const tProx = c.inicio + (c.prox * c.dur) / c.L;
    c.inicio = tProx - (c.prox * novaDur) / c.L;
    c.dur = novaDur;
  }

  function agoraVisual() {
    if (!ac) return 0;
    const lat = ac.outputLatency || ac.baseLatency || 0;
    return ac.currentTime - lat;
  }

  function cicloEm(t) {
    for (let i = ciclos.length - 1; i >= 0; i--) if (ciclos[i].inicio <= t) return ciclos[i];
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Toque junto                                                         */
  /* ------------------------------------------------------------------ */
  const toques = [];  // marcas para o desenho
  const placar = { n: 0, mosca: 0, somaAbs: 0, soma: 0 };

  function classificar(ms) {
    const a = Math.abs(ms);
    if (a < 35) return 'ok';
    if (a < 80) return 'medio';
    return 'ruim';
  }

  function toque(camada) {
    garantirAudio();
    const pad = camada === 'a' ? $('padA') : $('padB');
    pad.classList.add('batida');
    setTimeout(() => pad.classList.remove('batida'), 90);

    if (st.somToque) {
      tocarSom(camada === 'a' ? st.somA : st.somB, ac.currentTime, (camada === 'a' ? st.volA : st.volB) / 100 * 0.9, false);
    }

    const fb = camada === 'a' ? $('fbA') : $('fbB');
    if (!tocando) {
      fb.textContent = 'aperte Tocar';
      fb.className = 'pad-feedback';
      return;
    }
    const t = agoraVisual();
    const c = cicloEm(t);
    if (!c || c.contagem) {
      fb.textContent = 'espere o 1';
      fb.className = 'pad-feedback';
      return;
    }
    const n = camada === 'a' ? c.a : c.b;
    const pos = ((t - c.inicio) / c.dur) * n;
    const k = Math.round(pos);
    const ms = ((pos - k) * c.dur * 1000) / n;
    const cls = classificar(ms);
    const r = Math.round(ms);
    fb.textContent = r === 0 ? '0 ms' : `${r > 0 ? '+' : '−'}${Math.abs(r)} ms`;
    fb.title = r > 0 ? 'atrasado' : r < 0 ? 'adiantado' : 'no tempo';
    fb.className = `pad-feedback ${cls}`;

    placar.n++;
    if (cls === 'ok') placar.mosca++;
    placar.somaAbs += Math.abs(ms);
    placar.soma += ms;
    atualizarPlacar();

    toques.push({ camada, fase: (t - c.inicio) / c.dur, cls, quando: performance.now() });
    if (toques.length > 40) toques.shift();
    sujo = true;
  }

  function atualizarPlacar() {
    $('stToques').textContent = String(placar.n);
    if (!placar.n) {
      $('stMosca').textContent = '–';
      $('stDesvio').textContent = '–';
      $('stTend').textContent = '–';
      return;
    }
    $('stMosca').textContent = `${Math.round((placar.mosca / placar.n) * 100)}%`;
    $('stDesvio').textContent = `${Math.round(placar.somaAbs / placar.n)} ms`;
    const m = placar.soma / placar.n;
    $('stTend').textContent = Math.abs(m) < 8 ? 'no tempo' : m > 0 ? `atrasa ${Math.round(m)}` : `adianta ${Math.round(-m)}`;
  }

  /* ------------------------------------------------------------------ */
  /* Cores e fontes do tema                                              */
  /* ------------------------------------------------------------------ */
  let cores = {};
  let fonteRotulo = 'sans-serif';
  let fonteTitulo = 'serif';
  function lerTema() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    cores = {
      a: v('--a'), b: v('--b'), tinta: v('--tinta'), suave: v('--tinta-suave'),
      grade: v('--grade'), cartao: v('--cartao'), papel: v('--papel'),
      ok: v('--ok'), medio: v('--medio'), ruim: v('--ruim'), verde: v('--verde'),
    };
    fonteRotulo = v('--f-rotulo') || 'sans-serif';
    fonteTitulo = v('--f-titulo') || 'serif';
    sujo = true;
  }

  /* ------------------------------------------------------------------ */
  /* Desenho                                                             */
  /* ------------------------------------------------------------------ */
  const cvC = $('cvCirculo');
  const cvL = $('cvLinha');
  let sujo = true;
  let ultimoCiclo = null;
  let ultimoPasso = -1;
  const flash = { a: { quando: -1e9, k: 0 }, b: { quando: -1e9, k: 0 } };

  function prepararCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    return { g, w: r.width, h: r.height };
  }

  function comAlfa(cor, alfa) {
    // aceita #rrggbb
    if (cor && cor[0] === '#' && cor.length === 7) {
      const n = parseInt(cor.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
    }
    return cor;
  }

  function intensidade(qual, agora) {
    return Math.max(0, 1 - (agora - flash[qual].quando) / 260);
  }

  function pontosPoligono(n, cx, cy, raio) {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const ang = -Math.PI / 2 + (k / n) * Math.PI * 2;
      pts.push([cx + Math.cos(ang) * raio, cy + Math.sin(ang) * raio, ang]);
    }
    return pts;
  }

  function desenharCamadaCirculo(g, n, pts, cor, mudo, qual, agora, s, cx, cy, raioRotulo) {
    const alfa = mudo ? 0.28 : 1;
    g.save();
    g.globalAlpha = alfa;
    if (n >= 2) {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (n >= 3) g.closePath();
      g.fillStyle = comAlfa(cor, 0.1);
      if (n >= 3) g.fill();
      g.strokeStyle = cor;
      g.lineWidth = Math.max(1.5, s * 0.006);
      if (mudo) g.setLineDash([s * 0.015, s * 0.012]);
      g.stroke();
      g.setLineDash([]);
    }
    const f = intensidade(qual, agora);
    const r0 = s * 0.03;
    g.font = `700 ${Math.round(s * 0.042)}px ${fonteRotulo}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    pts.forEach(([x, y, ang], k) => {
      const ativo = !mudo && flash[qual].k === k ? f : 0;
      if (ativo > 0) {
        g.beginPath();
        g.fillStyle = comAlfa(cor, 0.3 * ativo);
        g.arc(x, y, r0 * (1.6 + 1.4 * ativo), 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.fillStyle = cor;
      g.arc(x, y, r0 * (1 + 0.45 * ativo), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = cor;
      g.fillText(String(k + 1), cx + Math.cos(ang) * raioRotulo, cy + Math.sin(ang) * raioRotulo);
    });
    g.restore();
  }

  function desenharCirculo(c, fase, agora) {
    const { g, w, h } = prepararCanvas(cvC);
    const s = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const RA = s * 0.385;
    const RB = s * 0.25;
    const a = c ? c.a : st.a;
    const b = c ? c.b : st.b;
    const L = lcm(a, b);

    // anel da grade comum
    g.lineWidth = 1;
    g.strokeStyle = cores.grade;
    g.beginPath();
    g.arc(cx, cy, RA, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, RB, 0, Math.PI * 2);
    g.stroke();

    const passoAtual = c && tocando ? Math.floor(fase * L + 1e-6) : -1;
    for (let i = 0; i < L; i++) {
      const ang = -Math.PI / 2 + (i / L) * Math.PI * 2;
      const r1 = RB - s * 0.03;
      const r2 = RA + s * 0.03;
      g.beginPath();
      g.strokeStyle = i === passoAtual ? cores.tinta : cores.grade;
      g.lineWidth = i === passoAtual ? 2 : 1;
      g.setLineDash(i === 0 ? [] : [3, 4]);
      g.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      g.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      g.stroke();
    }
    g.setLineDash([]);

    // arco de progresso
    if (c && tocando) {
      g.beginPath();
      g.strokeStyle = comAlfa(cores.tinta, 0.12);
      g.lineWidth = s * 0.05;
      g.arc(cx, cy, (RA + RB) / 2, -Math.PI / 2, -Math.PI / 2 + fase * Math.PI * 2);
      g.stroke();
    }

    const ptsA = pontosPoligono(a, cx, cy, RA);
    const ptsB = pontosPoligono(b, cx, cy, RB);
    desenharCamadaCirculo(g, b, ptsB, cores.b, mudoB(c), 'b', agora, s, cx, cy, RB - s * 0.075);
    desenharCamadaCirculo(g, a, ptsA, cores.a, mudoA(c), 'a', agora, s, cx, cy, RA + s * 0.075);

    // ponteiro
    const angP = -Math.PI / 2 + fase * Math.PI * 2;
    g.beginPath();
    g.strokeStyle = cores.tinta;
    g.lineWidth = Math.max(2, s * 0.008);
    g.lineCap = 'round';
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(angP) * (RA + s * 0.04), cy + Math.sin(angP) * (RA + s * 0.04));
    g.stroke();
    g.beginPath();
    g.fillStyle = cores.tinta;
    g.arc(cx, cy, s * 0.018, 0, Math.PI * 2);
    g.fill();

    // centro
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (c && c.contagem) {
      g.fillStyle = cores.tinta;
      g.font = `700 ${Math.round(s * 0.05)}px ${fonteRotulo}`;
      g.fillText('CONTAGEM', cx, cy + s * 0.07);
    } else if (c && c.variacao === '0') {
      g.fillStyle = cores.verde;
      g.font = `700 ${Math.round(s * 0.045)}px ${fonteRotulo}`;
      g.fillText('SÓ POR DENTRO', cx, cy + s * 0.07);
    }
  }

  function desenharLinha(c, fase, agora) {
    const { g, w, h } = prepararCanvas(cvL);
    const a = c ? c.a : st.a;
    const b = c ? c.b : st.b;
    const L = lcm(a, b);
    const estreito = w < 520;
    const esq = estreito ? 54 : 84;
    const dir = estreito ? 18 : 28;
    const x0 = esq;
    const x1 = w - dir;
    const larg = x1 - x0;
    const yA = h * 0.2;
    const yB = h * 0.52;
    const yR = h * 0.84;
    const xDe = (f) => x0 + f * larg;
    const mA = mudoA(c);
    const mB = mudoB(c);
    const tamNum = estreito ? 12 : 14;

    // grade comum
    const passo = larg / L;
    const passoAtual = c && tocando ? Math.floor(fase * L + 1e-6) : -1;
    if (passo >= 3) {
      for (let i = 0; i <= L; i++) {
        const x = xDe(i / L);
        g.beginPath();
        const borda = i === 0 || i === L;
        g.strokeStyle = borda ? cores.suave : cores.grade;
        g.lineWidth = borda ? 1.5 : 1;
        g.setLineDash(borda ? [] : [3, 4]);
        g.moveTo(x, yA - 20);
        g.lineTo(x, yR + 12);
        g.stroke();
      }
      g.setLineDash([]);
    }
    if (passoAtual >= 0) {
      g.fillStyle = comAlfa(cores.tinta, 0.06);
      g.fillRect(xDe(passoAtual / L), yA - 20, passo, yR - yA + 32);
    }

    // rótulos das linhas
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `700 ${estreito ? 13 : 15}px ${fonteRotulo}`;
    g.fillStyle = cores.a;
    g.globalAlpha = mA ? 0.4 : 1;
    g.fillText(estreito ? `A·${a}` : `A · ${a}`, 6, yA);
    g.fillStyle = cores.b;
    g.globalAlpha = mB ? 0.4 : 1;
    g.fillText(estreito ? `B·${b}` : `B · ${b}`, 6, yB);
    g.globalAlpha = 1;
    g.fillStyle = cores.suave;
    g.fillText(estreito ? 'Junto' : 'Juntas', 6, yR);

    // trilhos
    const trilho = (y, cor, mudo) => {
      g.beginPath();
      g.strokeStyle = cor;
      g.globalAlpha = mudo ? 0.3 : 0.9;
      g.lineWidth = 2;
      g.moveTo(x0 - 8, y);
      g.lineTo(x1 + 8, y);
      g.stroke();
      g.globalAlpha = 1;
    };
    trilho(yA, cores.a, mA);
    trilho(yB, cores.b, mB);
    trilho(yR, cores.grade, false);

    const raio = estreito ? 6 : 7.5;
    const pontos = (n, y, cor, mudo, qual, numAcima) => {
      const f = intensidade(qual, agora);
      g.font = `700 ${tamNum}px ${fonteRotulo}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let k = 0; k <= n; k++) {
        const x = xDe(k / n);
        const proximo = k === n;
        const ativo = !mudo && !proximo && flash[qual].k === k ? f : 0;
        g.globalAlpha = mudo ? 0.3 : 1;
        if (ativo > 0) {
          g.beginPath();
          g.fillStyle = comAlfa(cor, 0.3 * ativo);
          g.arc(x, y, raio * (1.8 + ativo), 0, Math.PI * 2);
          g.fill();
        }
        g.beginPath();
        g.arc(x, y, raio * (1 + 0.4 * ativo), 0, Math.PI * 2);
        if (proximo) {
          g.fillStyle = cores.cartao;
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = cor;
          g.stroke();
        } else {
          g.fillStyle = cor;
          g.fill();
        }
        g.fillStyle = cor;
        g.fillText(String(proximo ? 1 : k + 1), x, y + (numAcima ? -raio - 10 : raio + 11));
      }
      g.globalAlpha = 1;
    };
    pontos(a, yA, cores.a, mA, 'a', true);
    pontos(b, yB, cores.b, mB, 'b', false);

    // resultante
    for (let i = 0; i < L; i++) {
      const x = xDe(i / L);
      const ha = i % (L / a) === 0 && !mA;
      const hb = i % (L / b) === 0 && !mB;
      g.beginPath();
      if (ha && hb) { g.fillStyle = cores.tinta; g.arc(x, yR, raio, 0, Math.PI * 2); }
      else if (ha) { g.fillStyle = cores.a; g.arc(x, yR, raio * 0.75, 0, Math.PI * 2); }
      else if (hb) { g.fillStyle = cores.b; g.arc(x, yR, raio * 0.75, 0, Math.PI * 2); }
      else { g.fillStyle = cores.grade; g.arc(x, yR, 2, 0, Math.PI * 2); }
      g.fill();
    }

    // marcas dos toques
    const agoraMs = performance.now();
    for (const tq of toques) {
      const idade = (agoraMs - tq.quando) / 3000;
      if (idade >= 1) continue;
      const x = xDe(clamp(tq.fase, 0, 1));
      const y = tq.camada === 'a' ? yA : yB;
      g.globalAlpha = 1 - idade;
      g.strokeStyle = cores[tq.cls];
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y - 16);
      g.lineTo(x, y + 16);
      g.stroke();
    }
    g.globalAlpha = 1;

    // cursor
    if (c && tocando) {
      const x = xDe(fase);
      g.strokeStyle = cores.tinta;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, yA - 24);
      g.lineTo(x, yR + 14);
      g.stroke();
      g.fillStyle = cores.tinta;
      g.beginPath();
      g.moveTo(x - 6, yA - 30);
      g.lineTo(x + 6, yA - 30);
      g.lineTo(x, yA - 22);
      g.closePath();
      g.fill();
    }
  }

  /* Frase-guia */
  let fraseChave = '';
  function montarFrase(a, b, mA, mB) {
    const chave = `${a}:${b}:${mA}:${mB}`;
    if (chave === fraseChave) return;
    fraseChave = chave;
    const L = lcm(a, b);
    const el = $('frase');
    el.textContent = '';
    $('fraseInfo').textContent = `grade de ${L} ${L === 1 ? 'parte' : 'partes'} por ciclo`;
    if (L > 48) {
      const p = document.createElement('span');
      p.className = 'sil sil-0';
      p.textContent = `Grade fina demais para falar (${L} partes). Tente combinações menores.`;
      el.appendChild(p);
      return;
    }
    for (let i = 0; i < L; i++) {
      const ha = i % (L / a) === 0 && !mA;
      const hb = i % (L / b) === 0 && !mB;
      const s = document.createElement('span');
      if (ha && hb) { s.className = 'sil sil-ab'; s.textContent = 'TUM'; }
      else if (ha) { s.className = 'sil sil-a'; s.textContent = 'ta'; }
      else if (hb) { s.className = 'sil sil-b'; s.textContent = 'pá'; }
      else { s.className = 'sil sil-0'; s.textContent = '·'; }
      el.appendChild(s);
    }
  }

  let silMarcada = -1;
  function marcarFrase(i) {
    if (i === silMarcada) return;
    const filhos = $('frase').children;
    if (silMarcada >= 0 && filhos[silMarcada]) filhos[silMarcada].classList.remove('atual');
    if (i >= 0 && filhos[i]) filhos[i].classList.add('atual');
    silMarcada = i;
  }

  /* Prática: interface */
  const TEXTO_VARIACAO = {
    ab: 'as duas camadas soam',
    a: 'só a camada A soa; mantenha a B por dentro',
    b: 'só a camada B soa; mantenha a A por dentro',
    0: 'silêncio total; continue tocando as duas',
  };
  function atualizarPratica(c) {
    const lis = $('etapas').children;
    const etapa = c && c.etapa >= 0 ? c.etapa : -1;
    for (let i = 0; i < lis.length; i++) {
      lis[i].classList.toggle('ativa', i === etapa);
      lis[i].classList.toggle('feita', etapa >= 0 && i < etapa);
    }
    const btn = $('btnPratica');
    btn.setAttribute('aria-pressed', String(pratica.on));
    btn.textContent = pratica.on ? 'Encerrar prática' : 'Iniciar prática guiada';
    const status = $('praticaStatus');
    if (!pratica.on) {
      status.textContent = 'Desligada. O app toca as duas camadas sem parar.';
    } else if (!c || c.contagem || c.etapa < 0) {
      status.textContent = 'Começa na próxima volta, pela etapa 1…';
    } else {
      let txt = `Etapa ${etapa + 1} de 5 · ciclo ${c.cicloNaEtapa + 1} de ${st.ciclosEtapa}`;
      if (c.variacao) txt += ` · ${TEXTO_VARIACAO[c.variacao]}`;
      status.textContent = txt;
    }
  }

  function quadro() {
    requestAnimationFrame(quadro);
    const agora = performance.now();
    let c = null;
    let fase = 0;
    if (tocando && ac) {
      const t = agoraVisual();
      c = cicloEm(t);
      if (c) fase = clamp((t - c.inicio) / c.dur, 0, 0.99999);
    }

    if (c) {
      const passo = Math.floor(fase * c.L + 1e-6);
      if (c !== ultimoCiclo) {
        ultimoCiclo = c;
        ultimoPasso = -1;
        montarFrase(c.a, c.b, mudoA(c), mudoB(c));
        atualizarPratica(c);
        $('cntCiclo').textContent = c.contagem ? '…' : String(c.idx);
      } else {
        montarFrase(c.a, c.b, mudoA(c), mudoB(c));
      }
      if (passo !== ultimoPasso) {
        ultimoPasso = passo;
        if (!c.contagem) {
          if (passo % (c.L / c.a) === 0 && !mudoA(c)) { flash.a.quando = agora; flash.a.k = passo / (c.L / c.a); }
          if (passo % (c.L / c.b) === 0 && !mudoB(c)) { flash.b.quando = agora; flash.b.k = passo / (c.L / c.b); }
        }
        marcarFrase(c.contagem ? -1 : passo);
      }
      $('cntA').textContent = c.contagem ? '–' : String(Math.floor(fase * c.a) + 1);
      $('cntB').textContent = String(Math.floor(fase * c.b) + 1);
    } else if (!tocando) {
      montarFrase(st.a, st.b, st.muteA, st.muteB);
    }

    const animando = tocando || agora - flash.a.quando < 300 || agora - flash.b.quando < 300 ||
      toques.some((tq) => agora - tq.quando < 3000);
    if (!animando && !sujo) return;
    sujo = false;
    desenharCirculo(c, fase, agora);
    desenharLinha(c, fase, agora);
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */
  function montarPresets() {
    const box = $('presets');
    for (const [a, b] of PRESETS) {
      const bt = document.createElement('button');
      bt.type = 'button';
      bt.className = 'chip';
      bt.dataset.a = a;
      bt.dataset.b = b;
      bt.setAttribute('aria-label', `${a} contra ${b}`);
      bt.innerHTML = `<span class="ca">${a}</span> : <span class="cb">${b}</span>`;
      bt.addEventListener('click', () => { st.a = a; st.b = b; mudou(); });
      box.appendChild(bt);
    }
  }

  function renderizarUI() {
    $('valA').textContent = st.a;
    $('valB').textContent = st.b;
    $('razaoA').textContent = st.a;
    $('razaoB').textContent = st.b;
    $('padAn').textContent = st.a;
    $('padBn').textContent = st.b;
    $('bpm').value = st.bpm;
    $('bpmOut').textContent = st.bpm;
    $('ref').value = st.ref;
    $('somA').value = st.somA;
    $('somB').value = st.somB;
    $('volA').value = st.volA;
    $('volB').value = st.volB;
    $('optSub').checked = st.sub;
    $('optAcento').checked = st.acento;
    $('optContagem').checked = st.contagem;
    $('optSomToque').checked = st.somToque;
    $('ciclosEtapa').value = String(st.ciclosEtapa);
    $('incBpm').value = String(st.incBpm);

    for (const [id, mudo] of [['muteA', st.muteA], ['muteB', st.muteB]]) {
      const bt = $(id);
      bt.setAttribute('aria-pressed', String(mudo));
      bt.textContent = mudo ? 'Silenciada' : 'Som ligado';
    }

    const dur = duracaoCiclo(st.a, st.b, st.bpm, st.ref);
    const L = lcm(st.a, st.b);
    $('duracao').textContent = `${dur.toFixed(2).replace('.', ',')} s por ciclo · grade ${L}`;

    for (const ch of $('presets').children) {
      ch.setAttribute('aria-pressed', String(+ch.dataset.a === st.a && +ch.dataset.b === st.b));
    }

    const play = $('btnPlay');
    play.setAttribute('aria-pressed', String(tocando));
    $('lblPlay').textContent = tocando ? 'Parar' : 'Tocar';

    // Botões − e + desativados nos limites
    document.querySelectorAll('[data-layer]').forEach((bt) => {
      const v = st[bt.dataset.layer];
      bt.disabled = (+bt.dataset.d < 0 && v <= MIN_PULSOS) || (+bt.dataset.d > 0 && v >= MAX_PULSOS);
    });
    salvar();
  }

  function mudou() {
    renderizarUI();
    if (!tocando) fraseChave = '';
    sujo = true;
  }

  function mudarBpm(novo) {
    st.bpm = clamp(Math.round(novo), MIN_BPM, MAX_BPM);
    aplicarAndamentoAoVivo();
    mudou();
  }

  function alternarPlay() {
    if (tocando) parar(); else iniciar();
  }

  function ligarEventos() {
    $('btnPlay').addEventListener('click', alternarPlay);

    $('bpm').addEventListener('input', (e) => mudarBpm(+e.target.value));
    document.querySelectorAll('[data-bpm]').forEach((bt) => {
      bt.addEventListener('click', () => mudarBpm(st.bpm + +bt.dataset.bpm));
    });
    $('ref').addEventListener('change', (e) => { st.ref = e.target.value; aplicarAndamentoAoVivo(); mudou(); });

    document.querySelectorAll('[data-layer]').forEach((bt) => {
      bt.addEventListener('click', () => {
        const k = bt.dataset.layer;
        st[k] = clamp(st[k] + +bt.dataset.d, MIN_PULSOS, MAX_PULSOS);
        mudou();
      });
    });

    $('somA').addEventListener('change', (e) => {
      st.somA = e.target.value; salvar();
      garantirAudio(); tocarSom(st.somA, ac.currentTime + 0.01, st.volA / 100, false);
    });
    $('somB').addEventListener('change', (e) => {
      st.somB = e.target.value; salvar();
      garantirAudio(); tocarSom(st.somB, ac.currentTime + 0.01, st.volB / 100, false);
    });
    $('volA').addEventListener('input', (e) => { st.volA = +e.target.value; salvar(); });
    $('volB').addEventListener('input', (e) => { st.volB = +e.target.value; salvar(); });
    $('muteA').addEventListener('click', () => { st.muteA = !st.muteA; mudou(); });
    $('muteB').addEventListener('click', () => { st.muteB = !st.muteB; mudou(); });

    $('optSub').addEventListener('change', (e) => { st.sub = e.target.checked; salvar(); });
    $('optAcento').addEventListener('change', (e) => { st.acento = e.target.checked; salvar(); });
    $('optContagem').addEventListener('change', (e) => { st.contagem = e.target.checked; salvar(); });
    $('optSomToque').addEventListener('change', (e) => { st.somToque = e.target.checked; salvar(); });

    $('ciclosEtapa').addEventListener('change', (e) => { st.ciclosEtapa = +e.target.value; salvar(); });
    $('incBpm').addEventListener('change', (e) => { st.incBpm = +e.target.value; salvar(); });
    $('btnPratica').addEventListener('click', () => {
      if (pratica.on) {
        pratica.on = false;
        atualizarPratica(null);
        return;
      }
      pratica.on = true;
      pratica.etapa = 0;
      pratica.cicloNaEtapa = 0;
      pratica.ultimaVariacao = 'ab';
      if (!tocando) iniciar();
      atualizarPratica(null);
    });

    for (const [id, camada] of [['padA', 'a'], ['padB', 'b']]) {
      const pad = $(id);
      pad.addEventListener('pointerdown', (e) => { e.preventDefault(); toque(camada); });
      pad.addEventListener('click', (e) => { if (e.detail === 0) toque(camada); });
    }

    $('btnZerar').addEventListener('click', () => {
      placar.n = 0; placar.mosca = 0; placar.somaAbs = 0; placar.soma = 0;
      toques.length = 0;
      for (const id of ['fbA', 'fbB']) { $(id).textContent = '–'; $(id).className = 'pad-feedback'; }
      atualizarPlacar();
      sujo = true;
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target;
      const emCampo = alvo instanceof HTMLInputElement || alvo instanceof HTMLSelectElement || alvo instanceof HTMLTextAreaElement;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'f') {
        if (e.repeat || (emCampo && alvo.type !== 'range' && alvo.type !== 'checkbox')) return;
        e.preventDefault();
        toque(k === 'j' ? 'a' : 'b');
        return;
      }
      if (emCampo || alvo instanceof HTMLButtonElement || alvo.tagName === 'SUMMARY') return;
      if (e.code === 'Space') { e.preventDefault(); alternarPlay(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mudarBpm(st.bpm + 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); mudarBpm(st.bpm - 1); }
    });

    document.addEventListener('visibilitychange', () => { if (tocando) agendar(); });
    window.addEventListener('resize', () => { sujo = true; });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', lerTema);
    }
    new MutationObserver(lerTema).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { sujo = true; });
  }

  montarPresets();
  lerTema();
  ligarEventos();
  renderizarUI();
  atualizarPratica(null);
  atualizarPlacar();
  requestAnimationFrame(quadro);
})();
