import type { DemoKind, PortfolioProject } from '../data/projectsData';

interface LoadedSlide {
  src: string;
  label: string;
  img: HTMLImageElement | null;
  loaded: boolean;
  failed: boolean;
}

const DEFAULT_SCREENS: Record<DemoKind, Array<{ src: string; label: string }>> = {
  leitorECU: [
    { src: './screens/leitorecu/01-telemetry.png', label: 'Telemetria 30 FPS — Osciloscópio Triplo' },
    { src: './screens/leitorecu/02-map2d.png', label: 'Mapa 2D (RPM × MAP) — Avanço & Ignição' },
    { src: './screens/leitorecu/03-modules.png', label: 'Módulos & Diagnóstico — KWP2000 / UDS' },
    { src: './screens/leitorecu/04-fordka.png', label: 'Perfil Multi-Veículo — Ford HS-CAN' },
  ],
  vstable: [
    { src: './screens/vstable/01-login.png', label: '1/7 • Autenticação Corporativa' },
    { src: './screens/vstable/02-transfer-dados.png', label: '2/7 • Dados da Transferência B2B' },
    { src: './screens/vstable/03-transfer-revisao.png', label: '3/7 • Revisão de Câmbio & Taxas' },
    { src: './screens/vstable/04-transfer-2fa.png', label: '4/7 • Validação 2FA TOTP (RFC 6238)' },
    { src: './screens/vstable/05-historico.png', label: '5/7 • Histórico de Liquidações' },
    { src: './screens/vstable/06-detalhes.png', label: '6/7 • Detalhes da Operação' },
    { src: './screens/vstable/07-beneficiario.png', label: '7/7 • Gestão de Beneficiário' },
  ],
  smarttalent: [
    { src: './screens/smarttalent/00-dashboard.png', label: 'Torre de Decisão Logística — Visão Executiva' },
    { src: './screens/smarttalent/01-risco-regiao.png', label: 'Risco de Atraso por Macro-Região' },
    { src: './screens/smarttalent/02-atraso-status.png', label: 'Distribuição de Atraso por Status' },
    { src: './screens/smarttalent/03-prejuizo-categoria.png', label: 'Prejuízo Acumulado por Categoria' },
    { src: './screens/smarttalent/04-envio-real-agendado.png', label: 'Dias de Envio Real vs Agendado' },
    { src: './screens/smarttalent/05-paradoxo-simpson.png', label: 'Paradoxo de Simpson por Segmento' },
    { src: './screens/smarttalent/06-prejuizo-acumulado.png', label: 'Curva de Prejuízo Acumulado (USD)' },
  ],
  chatbot: [],
  vincula: [],
  ordovitae: [],
  t2ia: [],
};

const FALLBACK_STATION_COLORS: Record<string, string> = {
  leitorECU: '#dc4c4c',
  vstable: '#2ea86f',
  chatbot: '#279b9e',
  vincula: '#4d79e8',
  ordovitae: '#c4528d',
  t2ia: '#c4a435',
  smarttalent: '#4a93d4',
};

function getStationAccent(project: PortfolioProject): string {
  const maybeColor = (project as PortfolioProject & { color?: string }).color;
  return maybeColor || FALLBACK_STATION_COLORS[project.id] || '#4a93d4';
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(74, 147, 212, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const clean = path.replace(/^\.\//, '').replace(/^\/+/, '');
  return `${base}/${clean}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Renders continuous, video-like application demonstrations onto a 1280x800
 * offscreen canvas for 3D project stations, using real screenshots and
 * authentic domain simulations.
 */
export class ScreenDemoRenderer {
  public static readonly WIDTH = 1280;
  public static readonly HEIGHT = 800;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly project: PortfolioProject;
  private readonly accentColor: string;
  private readonly demoKind: DemoKind;
  private readonly slides: LoadedSlide[] = [];

  private pendingAssetRefresh = false;
  private disposed = false;

  constructor(project: PortfolioProject) {
    this.project = project;
    this.accentColor = getStationAccent(project);
    this.demoKind = project.demoKind;

    this.canvas = document.createElement('canvas');
    this.canvas.width = ScreenDemoRenderer.WIDTH;
    this.canvas.height = ScreenDemoRenderer.HEIGHT;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for ScreenDemoRenderer.');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.ctx = ctx;

    this.initSlides();
  }

  private initSlides(): void {
    const defaults = DEFAULT_SCREENS[this.demoKind] ?? [];
    const sources: Array<{ src: string; label: string }> =
      this.project.screenshots && this.project.screenshots.length > 0
        ? this.project.screenshots.map((src, idx) => ({
            src,
            label: defaults[idx]?.label ?? `${this.project.shortName} • Tela ${idx + 1}`,
          }))
        : defaults;

    for (const item of sources) {
      const entry: LoadedSlide = {
        src: resolveAssetUrl(item.src),
        label: item.label,
        img: null,
        loaded: false,
        failed: false,
      };

      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (this.disposed) return;
        entry.img = img;
        entry.loaded = true;
        this.pendingAssetRefresh = true;
      };
      img.onerror = () => {
        if (this.disposed) return;
        entry.failed = true;
      };
      img.src = entry.src;
      this.slides.push(entry);
    }
  }

  public consumeAssetRefresh(): boolean {
    if (!this.pendingAssetRefresh) return false;
    this.pendingAssetRefresh = false;
    return true;
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public render(elapsedSeconds: number, isPlaying: boolean): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    switch (this.demoKind) {
      case 'leitorECU':
        this.renderLeitorEcu(elapsedSeconds);
        break;
      case 'vstable':
        this.renderVStable(elapsedSeconds);
        break;
      case 'chatbot':
        this.renderChatbot(elapsedSeconds);
        break;
      case 'vincula':
        this.renderVincula(elapsedSeconds);
        break;
      case 'ordovitae':
        this.renderOrdoVitae(elapsedSeconds);
        break;
      case 't2ia':
        this.renderT2IA(elapsedSeconds);
        break;
      case 'smarttalent':
        this.renderSmartTalent(elapsedSeconds);
        break;
    }

    this.drawPlaybackStatusPill(isPlaying);
    ctx.restore();
  }

  private drawPlaybackStatusPill(isPlaying: boolean): void {
    const ctx = this.ctx;
    const label = isPlaying ? 'AO VIVO • 20 FPS' : 'PAUSADO — OLHE PARA RETOMAR';
    ctx.font = '600 15px "IBM Plex Mono", "Consolas", monospace';
    const textW = ctx.measureText(label).width;
    const pillW = textW + 40;
    const pillH = 30;
    const x = ScreenDemoRenderer.WIDTH - pillW - 18;
    const y = 16;

    this.roundRect(
      x,
      y,
      pillW,
      pillH,
      6,
      isPlaying ? 'rgba(18, 20, 25, 0.88)' : 'rgba(18, 20, 25, 0.94)',
      isPlaying ? hexToRgba(this.accentColor, 0.75) : 'rgba(148, 163, 184, 0.36)',
    );

    ctx.beginPath();
    ctx.arc(x + 15, y + pillH / 2, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = isPlaying ? '#22c55e' : '#94a3b8';
    ctx.fill();

    ctx.fillStyle = isPlaying ? '#f1f5f9' : '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 26, y + pillH / 2 + 0.5);
  }

  // ---------------------------------------------------------------------------
  // 1. leitorECU — Real 4 screenshots + Live Lambda/KWP2000/RPM-MAP Telemetry HUD
  // ---------------------------------------------------------------------------
  private renderLeitorEcu(t: number): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    ctx.fillStyle = '#0c1017';
    ctx.fillRect(0, 0, w, h);

    const viewH = h - 154;
    const slideDuration = 4.2;
    const totalSlides = Math.max(1, this.slides.length);
    const totalCycle = slideDuration * totalSlides;
    const cycleT = t % totalCycle;
    const idx = Math.floor(cycleT / slideDuration) % totalSlides;
    const nextIdx = (idx + 1) % totalSlides;
    const localT = cycleT - idx * slideDuration;
    const fadeStart = slideDuration - 0.55;
    const fadeAlpha = localT > fadeStart ? easeInOutCubic((localT - fadeStart) / 0.55) : 0;

    this.drawSlideContainFaded(this.slides[idx], 0, 0, w, viewH, 1 - fadeAlpha);
    if (fadeAlpha > 0.005) {
      this.drawSlideContainFaded(this.slides[nextIdx], 0, 0, w, viewH, fadeAlpha);
    }

    // Subtle top-left caption for current screen
    const currentSlide = this.slides[idx];
    if (currentSlide) {
      ctx.font = '600 16px "IBM Plex Sans", "Segoe UI", sans-serif';
      const capW = ctx.measureText(currentSlide.label).width + 28;
      this.roundRect(18, 16, capW, 32, 6, 'rgba(13, 17, 23, 0.88)', 'rgba(148, 163, 184, 0.28)');
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(currentSlide.label, 32, 32.5);
    }

    // Live telemetry dock at bottom (154px)
    const dockY = viewH;
    ctx.fillStyle = '#11161f';
    ctx.fillRect(0, dockY, w, 154);
    ctx.strokeStyle = '#293241';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, dockY);
    ctx.lineTo(w, dockY);
    ctx.stroke();

    // Left: Live Lambda B1S1 Oscilloscope (0.15 - 0.85 V)
    const scopeX = 20;
    const scopeY = dockY + 12;
    const scopeW = 460;
    const scopeH = 130;
    this.roundRect(scopeX, scopeY, scopeW, scopeH, 8, '#0b0e14', '#26303d');

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('LAMBDA B1S1 (0.15 – 0.85 V)', scopeX + 14, scopeY + 22);

    const lambdaVal = 0.5 + 0.34 * Math.sin(t * 4.4) + 0.04 * Math.sin(t * 11.2);
    ctx.fillStyle = '#facc15';
    ctx.textAlign = 'right';
    ctx.fillText(`${lambdaVal.toFixed(3)} V`, scopeX + scopeW - 14, scopeY + 22);

    // 0.45V stoichiometric dashed line
    const plotX = scopeX + 14;
    const plotY = scopeY + 34;
    const plotW = scopeW - 28;
    const plotH = scopeH - 46;

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.26)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const midY = plotY + plotH * 0.5;
    ctx.moveTo(plotX, midY);
    ctx.lineTo(plotX + plotW, midY);
    ctx.stroke();
    ctx.restore();

    // Waveform
    ctx.beginPath();
    const samples = 90;
    for (let i = 0; i <= samples; i++) {
      const frac = i / samples;
      const sampleT = t - (1 - frac) * 4.5;
      const v = clamp(0.5 + 0.33 * Math.sin(sampleT * 4.4) + 0.04 * Math.sin(sampleT * 11.2), 0.1, 0.92);
      const px = plotX + frac * plotW;
      const py = plotY + plotH * (1 - (v - 0.08) / 0.88);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Center: KWP2000 Blocks 032 / 033 / 103
    const kwpX = 498;
    const kwpW = 430;
    this.roundRect(kwpX, scopeY, kwpW, scopeH, 8, '#0b0e14', '#26303d');

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('KWP2000 • 032906032AJ • BLOCOS 032/033/103', kwpX + 14, scopeY + 22);

    // Block 103.5 ethanol adaptation transitions 99.6% -> 68.4% smoothly over 10s cycle
    const resetPhase = (t % 10) / 10;
    const blend = resetPhase < 0.35 ? 0 : resetPhase < 0.65 ? easeInOutCubic((resetPhase - 0.35) / 0.3) : 1;
    const b103 = lerp(99.6, 68.4, blend);
    const b032 = lerp(-18.75, -3.1, blend);
    const b033 = 1.4 + Math.sin(t * 2.1) * 1.9;

    const cells = [
      { label: 'BLOCO 103.5 (ETANOL)', value: `${b103.toFixed(1)}%`, warn: b103 > 90 },
      { label: 'BLOCO 032 (LTFT)', value: `${b032.toFixed(2)}%`, warn: b032 < -12 },
      { label: 'BLOCO 033 (STFT)', value: `${b033 >= 0 ? '+' : ''}${b033.toFixed(1)}%`, warn: false },
    ];

    cells.forEach((cell, cIdx) => {
      const cx = kwpX + 14 + cIdx * 136;
      const cy = scopeY + 36;
      this.roundRect(cx, cy, 128, 86, 6, '#141a24', cell.warn ? this.accentColor : '#26303d');
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 11px "IBM Plex Sans", sans-serif';
      ctx.fillText(cell.label, cx + 10, cy + 24);
      ctx.fillStyle = cell.warn ? '#f87171' : '#38bdf8';
      ctx.font = '700 22px "IBM Plex Mono", monospace';
      ctx.fillText(cell.value, cx + 10, cy + 62);
    });

    // Right: Live RPM & MAP bars
    const rpmX = 946;
    const rpmW = w - rpmX - 20;
    this.roundRect(rpmX, scopeY, rpmW, scopeH, 8, '#0b0e14', '#26303d');

    const rpm = Math.round(2150 + 1850 * (0.5 + 0.5 * Math.sin(t * 0.9)));
    const mapKpa = Math.round(32 + 54 * (0.5 + 0.5 * Math.sin(t * 0.9 - 0.35)));

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('RPM', rpmX + 16, scopeY + 28);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 20px "IBM Plex Mono", monospace';
    ctx.fillText(`${rpm} rpm`, rpmX + rpmW - 16, scopeY + 28);

    this.drawProgressBar(rpmX + 16, scopeY + 38, rpmW - 32, 12, rpm / 6500, '#38bdf8');

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('MAP (COLETOR)', rpmX + 16, scopeY + 84);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 20px "IBM Plex Mono", monospace';
    ctx.fillText(`${mapKpa} kPa`, rpmX + rpmW - 16, scopeY + 84);

    this.drawProgressBar(rpmX + 16, scopeY + 94, rpmW - 32, 12, mapKpa / 105, '#34d399');
  }

  // ---------------------------------------------------------------------------
  // 2. V-Stable — 7-Screen Sequential Video Flow + Animated Cursor + Progress
  // ---------------------------------------------------------------------------
  private renderVStable(t: number): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    const headerH = 62;
    const totalSlides = Math.max(1, this.slides.length);
    const stepDuration = 3.2;
    const cycleT = t % (stepDuration * totalSlides);
    const idx = Math.floor(cycleT / stepDuration) % totalSlides;
    const nextIdx = (idx + 1) % totalSlides;
    const localT = cycleT - idx * stepDuration;
    const transStart = stepDuration - 0.45;
    const transAlpha = localT > transStart ? easeInOutCubic((localT - transStart) / 0.45) : 0;

    // Draw real screenshot area below header
    this.drawSlideCover(this.slides[idx], 0, headerH, w, h - headerH, 1 - transAlpha);
    if (transAlpha > 0.005) {
      this.drawSlideCover(this.slides[nextIdx], 0, headerH, w, h - headerH, transAlpha);
    }

    // Top workflow progress bar
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, headerH);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, headerH);
    ctx.lineTo(w, headerH);
    ctx.stroke();

    const stepLabels = ['Login', 'Dados', 'Revisão', '2FA TOTP', 'Histórico', 'Detalhes', 'Beneficiário'];
    const barStartX = 28;
    const stepW = 132;

    for (let i = 0; i < stepLabels.length; i++) {
      const sx = barStartX + i * stepW;
      const isDone = i < idx;
      const isActive = i === idx;

      ctx.beginPath();
      ctx.arc(sx + 12, headerH / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#10b981' : isDone ? '#065f46' : '#1e293b';
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = '#6ee7b7';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = isActive ? '#052e16' : '#e2e8f0';
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), sx + 12, headerH / 2 + 0.5);

      ctx.fillStyle = isActive ? '#ffffff' : isDone ? '#a7f3d0' : '#94a3b8';
      ctx.font = isActive ? '600 13px "IBM Plex Sans", sans-serif' : '500 13px "IBM Plex Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(stepLabels[i], sx + 28, headerH / 2 + 0.5);
    }

    // Overall flow progress bar at bottom of header
    const overallFrac = cycleT / (stepDuration * totalSlides);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(0, headerH - 3, w * overallFrac, 3);

    // Animated cursor moving to CTA targets on each screen
    const targets: Array<[number, number]> = [
      [880, 520], // Login "Entrar"
      [840, 610], // Transfer Dados "Continuar"
      [855, 635], // Revisão "Confirmar"
      [820, 585], // 2FA "Autenticar"
      [620, 390], // Histórico row
      [860, 490], // Detalhes "Beneficiário"
      [540, 460], // Beneficiário inspect
    ];
    const [tx, ty] = targets[idx] ?? [640, 480];
    const [prevX, prevY] = targets[(idx - 1 + targets.length) % targets.length] ?? [400, 400];
    const moveFrac = easeInOutCubic(clamp(localT / 1.4, 0, 1));
    const cx = lerp(prevX, tx, moveFrac);
    const cy = lerp(prevY, ty, moveFrac);
    const clicking = localT > 1.8 && localT < 2.55;
    const clickProg = clicking ? (localT - 1.8) / 0.75 : 0;

    this.drawCursor(cx, cy, clicking, clickProg, '#10b981');
  }

  // ---------------------------------------------------------------------------
  // 3. V-Stable Chatbot IA — SupportChatWidget.tsx Simulation + Nielsen Timer
  // ---------------------------------------------------------------------------
  private renderChatbot(t: number): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    // Clean slate background matching V-Stable workspace
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, w, h);

    // Subtle workspace backdrop lines
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(44, 42, 430, h - 84);
    this.roundRect(44, 42, 430, h - 84, 14, '#ffffff', '#cbd5e1');

    // Left context card: SupportChatWidget Specs & Quick Prompts
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 22px "Space Grotesk", "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SupportChatWidget.tsx', 72, 92);

    ctx.fillStyle = '#475569';
    ctx.font = '400 15px "IBM Plex Sans", sans-serif';
    ctx.fillText('Arquitetura Zero-PII • Heurísticas de Nielsen', 72, 118);

    const cycle = t % 18;
    const isSecondQ = cycle >= 9;

    const quickPrompts = [
      'Por que não consigo fazer transações com a Colômbia?',
      'Como ativar a verificação em duas etapas?',
      'Como funcionam o representante e os membros?',
      'Quais países e moedas a V-Stable suporta?',
    ];

    quickPrompts.forEach((qp, i) => {
      const py = 152 + i * 74;
      const isSelected = (i === 0 && !isSecondQ) || (i === 1 && isSecondQ);
      this.roundRect(
        72,
        py,
        374,
        60,
        10,
        isSelected ? '#ecfdf5' : '#f8fafc',
        isSelected ? '#10b981' : '#cbd5e1',
      );
      ctx.fillStyle = isSelected ? '#065f46' : '#334155';
      ctx.font = isSelected ? '600 14px "IBM Plex Sans", sans-serif' : '500 14px "IBM Plex Sans", sans-serif';
      this.drawWrappedText(qp, 88, py + 24, 342, 19, 2);
    });

    // Guardrail stats panel bottom-left
    this.roundRect(72, 470, 374, 240, 10, '#0f172a', '#1e293b');
    ctx.fillStyle = '#10b981';
    ctx.font = '700 13px "IBM Plex Mono", monospace';
    ctx.fillText('GUARDRAILS & RATE-LIMIT', 92, 502);

    const stats = [
      ['Política de Dados', 'Zero-PII (Sem CPF/CNPJ no prompt)'],
      ['Rate Limit', '15 req/min + Cooldown Nielsen'],
      ['Fallback Híbrido', 'Offline Determinístico Ativo'],
      ['Provedores LLM', 'Gemini / DeepSeek-V3'],
    ];
    stats.forEach(([k, v], i) => {
      const sy = 538 + i * 42;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 13px "IBM Plex Sans", sans-serif';
      ctx.fillText(k, 92, sy);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 14px "IBM Plex Mono", monospace';
      ctx.fillText(v, 92, sy + 18);
    });

    // Right Chat Window (720px wide)
    const chatX = 504;
    const chatY = 42;
    const chatW = 732;
    const chatH = h - 84;
    this.roundRect(chatX, chatY, chatW, chatH, 16, '#ffffff', '#cbd5e1');

    // Emerald / Slate Chat Header
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(chatX, chatY, chatW, 74, [16, 16, 0, 0]);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(chatX + 42, chatY + 37, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 15px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('IA', chatX + 42, chatY + 37);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px "Space Grotesk", "IBM Plex Sans", sans-serif';
    ctx.fillText('Assistente Virtual V-Stable', chatX + 74, chatY + 33);
    ctx.fillStyle = '#34d399';
    ctx.font = '500 13px "IBM Plex Sans", sans-serif';
    ctx.fillText('Online • Suporte Operacional B2B', chatX + 74, chatY + 54);

    // Chat conversation phase inside 9s sub-cycle
    const localT = cycle % 9;
    const qText = isSecondQ
      ? 'Como ativar a verificação em duas etapas?'
      : 'Por que não consigo fazer transações com a Colômbia?';
    const aText = isSecondQ
      ? 'Acesse Configurações → Segurança → Autenticação 2FA. Escaneie o QR Code no app autenticador (TOTP RFC 6238). O segredo é cifrado em AES-256-GCM no backend.'
      : 'Operações para a Colômbia dependem de habilitação regulatória de corredor e revisão KYB do beneficiário. Trilhos ativos imediatos: PIX (BRL), ACH/Wire (USD) e SEPA (EUR).';

    // User bubble appears at 0.6s
    if (localT >= 0.4) {
      const bubbleW = 480;
      const bubbleX = chatX + chatW - bubbleW - 28;
      const bubbleY = chatY + 104;
      this.roundRect(bubbleX, bubbleY, bubbleW, 74, 14, '#059669');
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 16px "IBM Plex Sans", sans-serif';
      this.drawWrappedText(qText, bubbleX + 20, bubbleY + 30, bubbleW - 40, 23, 2);
    }

    // Typing indicator "..." from 1.2s to 2.8s
    if (localT >= 1.2 && localT < 2.8) {
      const tyX = chatX + 28;
      const tyY = chatY + 204;
      this.roundRect(tyX, tyY, 96, 46, 12, '#f1f5f9', '#cbd5e1');
      for (let d = 0; d < 3; d++) {
        const bounce = Math.sin(t * 9 - d * 1.1) * 4;
        ctx.beginPath();
        ctx.arc(tyX + 28 + d * 20, tyY + 23 + bounce, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#059669';
        ctx.fill();
      }
    }

    // Bot response appears from 2.8s onward
    if (localT >= 2.8) {
      const respX = chatX + 28;
      const respY = chatY + 204;
      const respW = 540;
      this.roundRect(respX, respY, respW, 148, 14, '#f8fafc', '#cbd5e1');
      ctx.fillStyle = '#059669';
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillText('ASSISTENTE V-STABLE • ZERO-PII', respX + 20, respY + 26);

      ctx.fillStyle = '#0f172a';
      ctx.font = '400 16px "IBM Plex Sans", sans-serif';
      this.drawWrappedText(aText, respX + 20, respY + 54, respW - 40, 24, 4);

      // Nielsen cooldown countdown bar (6s -> 0s)
      const cooldownRem = Math.max(0, Math.ceil(9 - localT));
      const cooldownFrac = clamp((localT - 2.8) / 6.2, 0, 1);
      const barY = respY + 170;
      this.roundRect(respX, barY, respW, 44, 10, '#ecfdf5', '#a7f3d0');
      ctx.fillStyle = '#065f46';
      ctx.font = '600 14px "IBM Plex Mono", monospace';
      ctx.fillText(
        `Cooldown Nielsen (anti-spam): ${cooldownRem}s para próxima consulta`,
        respX + 18,
        barY + 27,
      );
      this.drawProgressBar(respX + 18, barY + 34, respW - 36, 4, 1 - cooldownFrac, '#10b981');
    }

    // Input bar at bottom of chat
    const inpY = chatY + chatH - 76;
    this.roundRect(chatX + 24, inpY, chatW - 48, 52, 10, '#f8fafc', '#cbd5e1');
    ctx.fillStyle = '#64748b';
    ctx.font = '400 15px "IBM Plex Sans", sans-serif';
    ctx.fillText('Digite sua dúvida sobre câmbio, remessas ou 2FA...', chatX + 44, inpY + 31);
    this.roundRect(chatX + chatW - 124, inpY + 8, 86, 36, 8, '#059669');
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 14px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Enviar', chatX + chatW - 81, inpY + 31);

    // Animated cursor hovering the active prompt on the left
    const promptIndex = isSecondQ ? 1 : 0;
    const cursorX = lerp(310, 260, Math.sin(t * 1.2) * 0.5 + 0.5);
    const cursorY = 182 + promptIndex * 74;
    this.drawCursor(cursorX, cursorY, localT < 0.7, localT / 0.7, '#10b981');
  }

  // ---------------------------------------------------------------------------
  // 4. Vincula — @neo4j-nvl/react Interactive Link Graph + NodeModal Simulation
  // ---------------------------------------------------------------------------
  private renderVincula(t: number): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    // Clean light canvas #F8F9FA
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, w, h);

    // Top Header #1A2128 with #FF5D00 orange accent
    const hdrH = 60;
    ctx.fillStyle = '#1A2128';
    ctx.fillRect(0, 0, w, hdrH);
    ctx.fillStyle = '#FF5D00';
    ctx.fillRect(0, hdrH - 4, w, 4);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 20px "Space Grotesk", "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Vincula', 24, hdrH / 2 - 1);

    ctx.fillStyle = '#FF8300';
    ctx.font = '600 14px "IBM Plex Mono", monospace';
    ctx.fillText('CASO #2026-041 • GRAFO DE VÍNCULOS (@neo4j-nvl/react)', 114, hdrH / 2);

    // Left filter panel (#FFFFFF)
    const sideW = 248;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, hdrH, sideW, h - hdrH);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sideW, hdrH);
    ctx.lineTo(sideW, h);
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1A2128';
    ctx.font = '700 14px "IBM Plex Sans", sans-serif';
    ctx.fillText('BASES INTEGRADAS', 20, hdrH + 34);

    const bases = [
      { name: 'SIMBA (Bancário)', count: '42 registros', color: '#007bff' },
      { name: 'SITTEL (Telefonia)', count: '18 ERBs', color: '#007bff' },
      { name: 'RIF / COAF', count: '6 alertas', color: '#007bff' },
      { name: 'Extrato.csv', count: '124 lançamentos', color: '#007bff' },
    ];
    bases.forEach((b, i) => {
      const by = hdrH + 54 + i * 54;
      this.roundRect(18, by, sideW - 36, 44, 8, '#F8F9FA', '#E2E8F0');
      ctx.fillStyle = b.color;
      ctx.fillRect(26, by + 13, 8, 18);
      ctx.fillStyle = '#1A2128';
      ctx.font = '600 13px "IBM Plex Sans", sans-serif';
      ctx.fillText(b.name, 42, by + 20);
      ctx.fillStyle = '#64748B';
      ctx.font = '400 11px "IBM Plex Mono", monospace';
      ctx.fillText(b.count, 42, by + 36);
    });

    // Legend
    ctx.fillStyle = '#1A2128';
    ctx.font = '700 13px "IBM Plex Sans", sans-serif';
    ctx.fillText('LEGENDA DE NÓS', 20, hdrH + 304);
    const legend: Array<[string, string]> = [
      ['#e04141', 'Investigado Principal'],
      ['#f0ad4e', 'Entidades / Contas'],
      ['#007bff', 'Bases / Arquivos'],
    ];
    legend.forEach(([col, lbl], i) => {
      const ly = hdrH + 332 + i * 32;
      ctx.beginPath();
      ctx.arc(30, ly - 4, 8, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.font = '500 13px "IBM Plex Sans", sans-serif';
      ctx.fillText(lbl, 48, ly);
    });

    // Graph area
    const graphX = sideW;
    const graphW = w - sideW;
    const centerX = graphX + graphW * 0.42;
    const centerY = hdrH + (h - hdrH) * 0.5;

    // Subtle grid dots on graph canvas
    ctx.fillStyle = '#DCE2E8';
    for (let gx = graphX + 32; gx < w - 16; gx += 32) {
      for (let gy = hdrH + 32; gy < h - 16; gy += 32) {
        ctx.fillRect(gx, gy, 2, 2);
      }
    }

    const nodes = [
      {
        id: 'beto',
        label: 'Beto Barbosa',
        sub: 'Investigado',
        x: centerX + Math.sin(t * 1.1) * 6,
        y: centerY + Math.cos(t * 0.9) * 5,
        r: 34,
        color: '#e04141',
      },
      {
        id: 'bb',
        label: 'Banco do Brasil Ag 4546',
        sub: 'Conta 88412-9',
        x: centerX - 185 + Math.cos(t * 1.2) * 8,
        y: centerY - 135 + Math.sin(t * 1.0) * 7,
        r: 26,
        color: '#f0ad4e',
      },
      {
        id: 'empx',
        label: 'Empresa X Ltda',
        sub: 'CNPJ 12.345.678/0001-90',
        x: centerX + 185 + Math.sin(t * 0.8 + 1) * 8,
        y: centerY - 120 + Math.cos(t * 1.1) * 7,
        r: 26,
        color: '#f0ad4e',
      },
      {
        id: 'simba',
        label: 'SIMBA',
        sub: 'Quebra Sigilo',
        x: centerX - 210 + Math.sin(t * 0.9 + 2) * 7,
        y: centerY + 135 + Math.cos(t * 1.3) * 6,
        r: 23,
        color: '#007bff',
      },
      {
        id: 'sittel',
        label: 'SITTEL',
        sub: 'ERBs & Ligações',
        x: centerX + 25 + Math.cos(t * 1.0 + 1) * 7,
        y: centerY + 205 + Math.sin(t * 1.2) * 6,
        r: 23,
        color: '#007bff',
      },
      {
        id: 'rif',
        label: 'RIF / Extrato.csv',
        sub: 'COAF Lote 03',
        x: centerX + 200 + Math.cos(t * 0.9 + 3) * 7,
        y: centerY + 145 + Math.sin(t * 1.1) * 6,
        r: 23,
        color: '#007bff',
      },
    ];

    const edges: Array<{ from: number; to: number; label: string; width: number; pulse: boolean }> = [
      { from: 0, to: 1, label: 'R$ 1.500', width: 3.5, pulse: true },
      { from: 0, to: 2, label: 'R$ 2.300', width: 4.5, pulse: true },
      { from: 1, to: 2, label: 'TED R$ 4.800', width: 2.5, pulse: true },
      { from: 3, to: 1, label: 'Lote 03', width: 2.0, pulse: false },
      { from: 4, to: 0, label: '14 chamadas', width: 2.2, pulse: false },
      { from: 5, to: 2, label: 'Extrato.csv', width: 2.2, pulse: false },
    ];

    // Draw edges + animated transfer pulses
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = nodes[e.from];
      const b = nodes[e.to];

      ctx.strokeStyle = e.pulse ? 'rgba(255, 93, 0, 0.55)' : 'rgba(100, 116, 139, 0.42)';
      ctx.lineWidth = e.width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      if (e.pulse) {
        const pFrac = (t * 0.55 + i * 0.27) % 1;
        const px = lerp(a.x, b.x, pFrac);
        const py = lerp(a.y, b.y, pFrac);
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#FF5D00';
        ctx.fill();
      }

      // Edge label pill
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.font = '600 12px "IBM Plex Mono", monospace';
      const lw = ctx.measureText(e.label).width + 14;
      this.roundRect(mx - lw / 2, my - 11, lw, 22, 4, '#FFFFFF', '#CBD5E1');
      ctx.fillStyle = e.pulse ? '#C2410C' : '#334155';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.label, mx, my + 0.5);
    }

    // Cycle: cursor moves to node 0 ("Beto Barbosa") or node 1 ("BB Ag 4546") and opens NodeModal
    const modalCycle = t % 9.0;
    const selectNodeIdx = Math.floor(t / 9.0) % 2 === 0 ? 0 : 1;
    const modalOpen = modalCycle > 2.2 && modalCycle < 8.2;
    const modalAlpha =
      modalCycle < 2.2
        ? 0
        : modalCycle < 2.6
          ? (modalCycle - 2.2) / 0.4
          : modalCycle > 7.8
            ? clamp((8.2 - modalCycle) / 0.4, 0, 1)
            : 1;

    // Draw nodes
    nodes.forEach((n, idx) => {
      const isSelected = modalOpen && idx === selectNodeIdx;
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#FF5D00';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#1A2128';
      ctx.font = '700 13px "IBM Plex Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(n.label, n.x, n.y + n.r + 8);
    });

    // Draw NodeModal when opened
    if (modalAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = modalAlpha;
      const mx = w - 348;
      const my = hdrH + 24;
      const mw = 322;
      const mh = 340;
      this.roundRect(mx, my, mw, mh, 12, '#FFFFFF', '#CBD5E1');
      ctx.fillStyle = '#1A2128';
      ctx.fillRect(mx, my, mw, 48);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 15px "Space Grotesk", "IBM Plex Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('NodeModal — Inspeção de Vínculo', mx + 16, my + 24);

      const target = nodes[selectNodeIdx];
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = target.color;
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillText(selectNodeIdx === 0 ? 'ALVO INVESTIGADO' : 'ENTIDADE BANCÁRIA', mx + 18, my + 78);

      ctx.fillStyle = '#1A2128';
      ctx.font = '700 19px "IBM Plex Sans", sans-serif';
      ctx.fillText(target.label, mx + 18, my + 104);

      const rows =
        selectNodeIdx === 0
          ? [
              ['CPF / Doc', '***.412.889-**'],
              ['Vínculos Ativos', '5 conexões (SIMBA/SITTEL)'],
              ['Movimentação', 'R$ 3.800,00 rastreados'],
              ['Arquivos', 'SIMBA_Lote03.csv, RIF_4921.pdf'],
            ]
          : [
              ['CNPJ / Agência', 'Ag 4546 • CC 88412-9'],
              ['Origem', 'SIMBA + Extrato.csv'],
              ['Transferências', 'R$ 1.500 -> Empresa X'],
              ['Arquivos', 'Extrato_BB_2026.csv'],
            ];

      rows.forEach(([k, v], rIdx) => {
        const ry = my + 136 + rIdx * 48;
        ctx.fillStyle = '#64748B';
        ctx.font = '600 12px "IBM Plex Sans", sans-serif';
        ctx.fillText(k.toUpperCase(), mx + 18, ry);
        ctx.fillStyle = '#0F172A';
        ctx.font = '500 14px "IBM Plex Mono", monospace';
        ctx.fillText(v, mx + 18, ry + 19);
      });
      ctx.restore();
    }

    // Animated cursor moving onto selected node
    const targetNode = nodes[selectNodeIdx];
    const moveT = easeInOutCubic(clamp(modalCycle / 1.8, 0, 1));
    const curX = lerp(centerX + 260, targetNode.x + 8, moveT);
    const curY = lerp(centerY + 180, targetNode.y + 8, moveT);
    const clicking = modalCycle >= 1.8 && modalCycle <= 2.3;
    this.drawCursor(curX, curY, clicking, (modalCycle - 1.8) / 0.5, '#FF5D00');
  }

  // ---------------------------------------------------------------------------
  // 5. OrdoVitae — SWALIS Clinical Bands + Daily Player + DeepSeek-V3 Card
  // ---------------------------------------------------------------------------
  private renderOrdoVitae(t: number): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Header
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, 80);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 80);
    ctx.lineTo(w, 80);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 24px "Space Grotesk", "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('OrdoVitae — Priorização Cirúrgica SUS', 28, 38);
    ctx.fillStyle = '#64748b';
    ctx.font = '400 14px "IBM Plex Sans", sans-serif';
    ctx.fillText('Fila cirúrgica · recalculada a cada dia · Protocolo SWALIS + DeepSeek-V3', 28, 62);

    // Day player scrubber
    const dayCycle = t % 12;
    const currentDay = Math.min(30, 1 + Math.floor((dayCycle / 12) * 30));

    // KPI row
    const kpis = [
      { label: 'NA FILA (SUS)', val: '941 pacientes', sub: '1.490 eventos clínicos', color: '#0f172a' },
      { label: 'REORDENAÇÕES IA', val: `${14 + Math.floor(currentDay * 0.9)} saltos`, sub: 'Agravamento detectado', color: '#dc2626' },
      { label: 'ALUCINAÇÃO LLM', val: '0,0%', sub: 'Validação literal 100%', color: '#16a34a' },
      { label: 'CUSTO DEEPSEEK-V3', val: '$0.0699', sub: '988 chamadas (-63% cache)', color: '#2563eb' },
    ];
    kpis.forEach((k, i) => {
      const kx = 28 + i * 308;
      this.roundRect(kx, 98, 292, 86, 10, '#ffffff', '#e2e8f0');
      ctx.fillStyle = '#64748b';
      ctx.font = '600 12px "IBM Plex Mono", monospace';
      ctx.fillText(k.label, kx + 16, 124);
      ctx.fillStyle = k.color;
      ctx.font = '700 24px "IBM Plex Mono", monospace';
      ctx.fillText(k.val, kx + 16, 154);
      ctx.fillStyle = '#64748b';
      ctx.font = '400 12px "IBM Plex Sans", sans-serif';
      ctx.fillText(k.sub, kx + 16, 174);
    });

    // SWALIS Legend strip
    const swalis: Array<[string, string, string]> = [
      ['A1', '#dc2626', 'Emergência / ≤ 7d'],
      ['A2', '#ea580c', 'Urgente / ≤ 30d'],
      ['B', '#d97706', 'Prioritário / ≤ 90d'],
      ['C', '#2563eb', 'Programável / ≤ 180d'],
      ['D', '#64748b', 'Eletivo / > 180d'],
    ];
    swalis.forEach(([code, col, desc], i) => {
      const sx = 28 + i * 150;
      this.roundRect(sx, 202, 140, 34, 6, '#ffffff', '#e2e8f0');
      this.roundRect(sx + 8, 208, 30, 22, 4, col);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(code, sx + 23, 223);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#334155';
      ctx.font = '500 11px "IBM Plex Sans", sans-serif';
      ctx.fillText(desc, sx + 44, 223);
    });

    // Left: Dynamic Queue Table with Priority Reordering
    const tableX = 28;
    const tableY = 252;
    const tableW = 738;
    const tableH = 448;
    this.roundRect(tableX, tableY, tableW, tableH, 12, '#ffffff', '#e2e8f0');

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px "IBM Plex Sans", sans-serif';
    ctx.fillText(`Fila Cirúrgica Dinâmica — Dia ${String(currentDay).padStart(2, '0')} / 30`, tableX + 20, tableY + 32);

    // Priority jump animation progress
    const jumpBlend = easeInOutCubic(clamp((dayCycle - 2.5) / 2.0, 0, 1));

    const patients = [
      {
        name: 'Maria S. Oliveira',
        proc: 'Colecistectomia Videolaparoscópica',
        oldRank: 3,
        newRank: 0,
        band: jumpBlend > 0.5 ? 'A1' : 'B',
        bandColor: jumpBlend > 0.5 ? '#dc2626' : '#d97706',
        score: Math.round(lerp(61, 96, jumpBlend)),
        tag: jumpBlend > 0.5 ? '↑ +3 pos (UPA)' : 'Estável',
      },
      {
        name: 'João P. Santos',
        proc: 'Hernioplastia Inguinal Bilateral',
        oldRank: 0,
        newRank: 1,
        band: 'A2',
        bandColor: '#ea580c',
        score: 88,
        tag: 'SWALIS Base',
      },
      {
        name: 'Ana C. Ferreira',
        proc: 'Artroplastia Total de Joelho',
        oldRank: 1,
        newRank: 2,
        band: 'B',
        bandColor: '#d97706',
        score: 74,
        tag: 'Prazo 78 dias',
      },
      {
        name: 'Carlos E. Lima',
        proc: 'Tireoidectomia Parcial',
        oldRank: 2,
        newRank: 3,
        band: 'C',
        bandColor: '#2563eb',
        score: 58,
        tag: 'Eletivo',
      },
      {
        name: 'Lúcia M. Costa',
        proc: 'Safenectomia Bilateral',
        oldRank: 4,
        newRank: 4,
        band: 'D',
        bandColor: '#64748b',
        score: 39,
        tag: 'Monitorado',
      },
    ];

    patients.forEach((p) => {
      const rank = lerp(p.oldRank, p.newRank, jumpBlend);
      const ry = tableY + 56 + rank * 74;
      const isHighlighted = p.oldRank === 3 && jumpBlend > 0.2;

      this.roundRect(
        tableX + 16,
        ry,
        tableW - 32,
        64,
        8,
        isHighlighted ? '#fef2f2' : '#f8fafc',
        isHighlighted ? '#dc2626' : '#e2e8f0',
      );

      // SWALIS badge
      this.roundRect(tableX + 28, ry + 16, 40, 32, 6, p.bandColor);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 14px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.band, tableX + 48, ry + 37);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 15px "IBM Plex Sans", sans-serif';
      ctx.fillText(p.name, tableX + 82, ry + 27);

      ctx.fillStyle = '#64748b';
      ctx.font = '400 13px "IBM Plex Sans", sans-serif';
      ctx.fillText(p.proc, tableX + 82, ry + 48);

      ctx.textAlign = 'right';
      ctx.fillStyle = isHighlighted ? '#dc2626' : '#334155';
      ctx.font = '700 15px "IBM Plex Mono", monospace';
      ctx.fillText(`Score ${p.score}`, tableX + tableW - 32, ry + 27);
      ctx.font = '600 12px "IBM Plex Mono", monospace';
      ctx.fillText(p.tag, tableX + tableW - 32, ry + 47);
    });

    // Right: DeepSeek-V3 Literal Extraction Card
    const cardX = 786;
    const cardY = 252;
    const cardW = w - cardX - 28;
    this.roundRect(cardX, cardY, cardW, tableH, 12, '#ffffff', '#e2e8f0');

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px "Space Grotesk", "IBM Plex Sans", sans-serif';
    ctx.fillText('Extração Semântica • DeepSeek-V3', cardX + 20, cardY + 34);

    this.roundRect(cardX + 20, cardY + 52, 220, 26, 6, '#dcfce7', '#86efac');
    ctx.fillStyle = '#166534';
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText('0% ALUCINAÇÃO • LITERAL', cardX + 32, cardY + 69);

    // Clinical snippet with highlighted literal substring
    this.roundRect(cardX + 20, cardY + 96, cardW - 40, 176, 8, '#f8fafc', '#cbd5e1');
    ctx.fillStyle = '#64748b';
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillText('PRONTUÁRIO ORIGINAL (TRECHO EXTRAÍDO)', cardX + 34, cardY + 118);

    ctx.fillStyle = '#334155';
    ctx.font = '400 14px "IBM Plex Sans", sans-serif';
    ctx.fillText('Paciente relata dor biliar progressiva com', cardX + 34, cardY + 146);

    // Highlighted literal span
    this.roundRect(cardX + 32, cardY + 156, 222, 26, 4, '#fef08a', '#eab308');
    ctx.fillStyle = '#713f12';
    ctx.font = '700 14px "IBM Plex Sans", sans-serif';
    ctx.fillText('"internação prévia em UPA"', cardX + 38, cardY + 174);

    ctx.fillStyle = '#334155';
    ctx.font = '400 14px "IBM Plex Sans", sans-serif';
    ctx.fillText('há 11 dias e 2 idas recentes ao PS por', cardX + 34, cardY + 204);
    ctx.fillText('náuseas intensas após alimentação.', cardX + 34, cardY + 226);

    // Verified output fields
    const fields = [
      ['Evidência Confirmada', 'internação prévia em UPA (+35 pts)'],
      ['Recorrência PS', '2 atendimentos de urgência (+12 pts)'],
      ['Nova Faixa SWALIS', 'B -> A1 (Prioridade Máxima)'],
    ];
    fields.forEach(([fk, fv], idx) => {
      const fy = cardY + 292 + idx * 48;
      ctx.fillStyle = '#64748b';
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      ctx.fillText(fk.toUpperCase(), cardX + 20, fy);
      ctx.fillStyle = idx === 2 ? '#dc2626' : '#0f172a';
      ctx.font = '600 14px "IBM Plex Sans", sans-serif';
      ctx.fillText(fv, cardX + 20, fy + 20);
    });

    // Bottom Timeline Player bar
    const playerY = h - 76;
    this.roundRect(28, playerY, w - 56, 54, 10, '#0f172a');
    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 14px "IBM Plex Mono", monospace';
    ctx.fillText(`PLAYER DIÁRIO • DIA ${String(currentDay).padStart(2, '0')} / 30`, 52, playerY + 32);
    this.drawProgressBar(350, playerY + 22, w - 410, 10, dayCycle / 12, this.accentColor);
  }

  // ---------------------------------------------------------------------------
  // 6. T2IA — Tkinter clam (#f5f6f8) Tab 2 (GA Fitness) & Tab 3 (Board + tanh)
  // ---------------------------------------------------------------------------
  private renderT2IA(t: number): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    // Tkinter clam background #f5f6f8
    ctx.fillStyle = '#f5f6f8';
    ctx.fillRect(0, 0, w, h);

    // Top Tkinter window bar & notebook tabs
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, w, 46);
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 16px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('T2IA — Rede Neural MLP + Algoritmo Genético (src/app.py)', 24, 23);

    const cycle = t % 18;
    const isTab3 = cycle >= 9;

    const tabs = [
      '1. Você vs Minimax',
      '2. Treinamento (Rede vs Minimax)',
      '3. Você vs Rede treinada',
    ];
    tabs.forEach((lbl, i) => {
      const tx = 24 + i * 285;
      const active = (i === 1 && !isTab3) || (i === 2 && isTab3);
      this.roundRect(
        tx,
        56,
        276,
        40,
        6,
        active ? '#ffffff' : '#e2e8f0',
        active ? '#cbd5e1' : '#cbd5e1',
      );
      ctx.fillStyle = active ? '#0f172a' : '#475569';
      ctx.font = active ? '700 14px "IBM Plex Sans", sans-serif' : '500 14px "IBM Plex Sans", sans-serif';
      ctx.fillText(lbl, tx + 16, 76);
    });

    ctx.textBaseline = 'alphabetic';

    if (!isTab3) {
      // TAB 2: Treinamento AG
      const genFrac = easeInOutCubic(clamp(cycle / 7.8, 0, 1));
      const gen = Math.max(1, Math.round(1 + genFrac * 99));

      // Main chart panel
      this.roundRect(24, 108, 790, 650, 10, '#ffffff', '#cbd5e1');
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 18px "IBM Plex Sans", sans-serif';
      ctx.fillText(`Evolução do Algoritmo Genético — Geração ${gen} / 100`, 48, 146);

      ctx.fillStyle = '#16a34a';
      ctx.font = '600 14px "IBM Plex Mono", monospace';
      ctx.fillText('● Melhor Fitness (Geração)', 48, 174);
      ctx.fillStyle = '#2563eb';
      ctx.fillText('● Fitness Médio Global', 298, 174);

      const gx = 68;
      const gy = 200;
      const gw = 710;
      const gh = 480;
      this.roundRect(gx, gy, gw, gh, 6, '#f8fafc', '#e2e8f0');

      // Grid lines
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      for (let g = 1; g < 5; g++) {
        const yLine = gy + (gh / 5) * g;
        ctx.beginPath();
        ctx.moveTo(gx, yLine);
        ctx.lineTo(gx + gw, yLine);
        ctx.stroke();
      }

      // Best fitness curve (#16a34a) and global avg (#2563eb)
      const drawCurve = (color: string, fn: (u: number) => number) => {
        ctx.beginPath();
        const steps = Math.max(2, Math.round(gen * 0.8));
        for (let i = 0; i <= steps; i++) {
          const u = (i / 80) * genFrac;
          const x = gx + 16 + u * (gw - 32);
          const y = gy + gh - 24 - fn(u) * (gh - 52);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
      };

      drawCurve('#2563eb', (u) => 0.14 + 0.61 * (1 - Math.exp(-3.2 * u)) + 0.02 * Math.sin(u * 28));
      drawCurve('#16a34a', (u) => 0.22 + 0.72 * (1 - Math.exp(-3.8 * u)) + 0.015 * Math.sin(u * 20));

      // Right: Population fitness bars with station gold elite (#c4a435)
      this.roundRect(834, 108, 422, 650, 10, '#ffffff', '#cbd5e1');
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 17px "IBM Plex Sans", sans-serif';
      ctx.fillText('População AG (BLX-α + Elitismo)', 858, 146);

      ctx.fillStyle = '#475569';
      ctx.font = '400 13px "IBM Plex Sans", sans-serif';
      ctx.fillText('Currículo: Médio -> Difícil • Top 4 Elite (Ocre)', 858, 170);

      for (let i = 0; i < 16; i++) {
        const by = 198 + i * 32;
        const isElite = i < 4;
        const score = clamp((1 - i * 0.048) * (0.45 + 0.53 * genFrac), 0.1, 0.99);
        ctx.fillStyle = '#475569';
        ctx.font = '600 12px "IBM Plex Mono", monospace';
        ctx.fillText(`#${String(i + 1).padStart(2, '0')}`, 858, by + 15);
        this.drawProgressBar(896, by + 4, 270, 14, score, isElite ? this.accentColor : '#2563eb');
        ctx.fillStyle = isElite ? '#856d1b' : '#0f172a';
        ctx.textAlign = 'right';
        ctx.fillText(`${(score * 100).toFixed(1)}%`, 1234, by + 15);
        ctx.textAlign = 'left';
      }
    } else {
      // TAB 3: Rede Treinada — Live 3x3 Match + tanh [-1..+1] Heatmap
      const localT = cycle - 9;
      const moveIdx = Math.min(6, Math.floor(localT / 1.25));

      // Board card left
      this.roundRect(24, 108, 600, 650, 10, '#ffffff', '#cbd5e1');
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 18px "IBM Plex Sans", sans-serif';
      ctx.fillText('Partida Ao Vivo: Humano (X) vs Rede Neural MLP (O)', 48, 146);

      const boardSize = 444;
      const bx = 102;
      const by = 196;
      const cellSize = boardSize / 3;

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 6;
      for (let l = 1; l <= 2; l++) {
        ctx.beginPath();
        ctx.moveTo(bx + l * cellSize, by);
        ctx.lineTo(bx + l * cellSize, by + boardSize);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(bx, by + l * cellSize);
        ctx.lineTo(bx + boardSize, by + l * cellSize);
        ctx.stroke();
      }

      // Sequence of moves in a smart draw/win match
      const seq: Array<{ cell: number; sym: 'X' | 'O' }> = [
        { cell: 4, sym: 'X' },
        { cell: 0, sym: 'O' },
        { cell: 2, sym: 'X' },
        { cell: 6, sym: 'O' },
        { cell: 3, sym: 'X' },
        { cell: 5, sym: 'O' },
      ];

      for (let m = 0; m < moveIdx; m++) {
        const mv = seq[m];
        const col = mv.cell % 3;
        const row = Math.floor(mv.cell / 3);
        const cx = bx + col * cellSize + cellSize / 2;
        const cy = by + row * cellSize + cellSize / 2;

        if (mv.sym === 'X') {
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 11;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - 38, cy - 38);
          ctx.lineTo(cx + 38, cy + 38);
          ctx.moveTo(cx + 38, cy - 38);
          ctx.lineTo(cx - 38, cy + 38);
          ctx.stroke();
        } else {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 11;
          ctx.beginPath();
          ctx.arc(cx, cy, 40, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.fillStyle = '#0f172a';
      ctx.font = '600 15px "IBM Plex Mono", monospace';
      ctx.fillText(`Acurácia vs Minimax: 94.8% • Camada Oculta: 18 neurônios`, 48, 710);

      // Right: OutputsCanvas 3x3 tanh [-1..+1] Heatmap
      this.roundRect(644, 108, 612, 650, 10, '#ffffff', '#cbd5e1');
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 18px "IBM Plex Sans", sans-serif';
      ctx.fillText('OutputsCanvas — Saídas tanh [-1 .. +1]', 670, 146);
      ctx.fillStyle = '#475569';
      ctx.font = '400 14px "IBM Plex Sans", sans-serif';
      ctx.fillText('Ativação por casa livre antes da escolha da jogada (O)', 670, 172);

      const vals = [
        [-0.84, 0.21, -0.76],
        [0.14, -0.92, 0.89],
        [0.64, 0.41, 0.33],
      ];
      // Perturb slightly with move index so it responds live
      const hx = 740;
      const hy = 218;
      const hCell = 136;
      const gap = 10;

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const idx = r * 3 + c;
          const occupied = seq.slice(0, moveIdx).some((s) => s.cell === idx);
          const v = occupied ? -0.95 : clamp(vals[r][c] + Math.sin(t * 2 + idx) * 0.08, -0.99, 0.99);
          const x = hx + c * (hCell + gap);
          const y = hy + r * (hCell + gap);

          // Red for negative, green/blue for positive
          let bg = '#f1f5f9';
          if (occupied) bg = '#e2e8f0';
          else if (v >= 0) bg = `rgba(22, 163, 74, ${(0.18 + v * 0.65).toFixed(2)})`;
          else bg = `rgba(220, 38, 38, ${(0.14 + Math.abs(v) * 0.5).toFixed(2)})`;

          const isBest = !occupied && r === 1 && c === 2;
          this.roundRect(x, y, hCell, hCell, 8, bg, isBest ? '#0f172a' : '#cbd5e1');

          ctx.fillStyle = occupied ? '#64748b' : '#0f172a';
          ctx.font = '700 20px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(occupied ? 'OCUP.' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, x + hCell / 2, y + hCell / 2 + 6);
        }
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#16a34a';
      ctx.font = '700 15px "IBM Plex Mono", monospace';
      ctx.fillText('Melhor saída tanh selecionada automaticamente pela MLP', 670, 710);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Smart Talent — Real Dashboard (clean crop) + Charts + Random Forest Card
  // ---------------------------------------------------------------------------
  private renderSmartTalent(t: number): void {
    const ctx = this.ctx;
    const w = ScreenDemoRenderer.WIDTH;
    const h = ScreenDemoRenderer.HEIGHT;

    ctx.fillStyle = '#f5f2eb';
    ctx.fillRect(0, 0, w, h);

    const totalSlides = Math.max(1, this.slides.length);
    const slideDuration = 3.8;
    const cycleT = t % (slideDuration * totalSlides);
    const idx = Math.floor(cycleT / slideDuration) % totalSlides;
    const slide = this.slides[idx];

    const mainW = 890;
    const mainH = h;

    if (slide && slide.loaded && slide.img) {
      if (idx === 0 && slide.src.includes('00-dashboard')) {
        // Stitch top header (y: 0..114) and executive body (y: 230..800) to skip red fetch banner cleanly
        const img = slide.img;
        const scale = mainW / img.width;
        const headerSrcH = Math.min(114, img.height);
        const headerDstH = headerSrcH * scale;
        ctx.drawImage(img, 0, 0, img.width, headerSrcH, 0, 0, mainW, headerDstH);

        const bodySrcY = Math.min(230, img.height - 10);
        const bodySrcH = img.height - bodySrcY;
        const bodyDstH = bodySrcH * scale;
        ctx.drawImage(img, 0, bodySrcY, img.width, bodySrcH, 0, headerDstH + 6, mainW, bodyDstH);
      } else {
        // Analytical matplotlib chart nicely framed with padding
        this.roundRect(24, 72, mainW - 48, mainH - 104, 12, '#ffffff', '#d6d3cd');
        this.drawSlideContain(slide, 38, 86, mainW - 76, mainH - 132);
      }
    } else {
      this.drawFallbackPlaceholder(0, 0, mainW, mainH, slide?.label ?? 'Smart Talent — Carregando...');
    }

    // Top-left clean caption bar on chart slides
    if (idx > 0 && slide) {
      ctx.fillStyle = '#1c1917';
      ctx.font = '700 18px "Space Grotesk", "IBM Plex Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(slide.label, 28, 46);
    }

    // Right: Animated Random Forest Predictive Triage Card (390px wide)
    const cardX = mainW + 14;
    const cardW = w - cardX - 18;
    const cardY = 58;
    const cardH = h - 76;
    this.roundRect(cardX, cardY, cardW, cardH, 12, '#1c1917', '#44403c');

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = this.accentColor;
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText('TRIAGEM PREDITIVA • RANDOM FOREST', cardX + 20, cardY + 34);

    ctx.fillStyle = '#fafaf9';
    ctx.font = '700 22px "Space Grotesk", "IBM Plex Sans", sans-serif';
    ctx.fillText('Alerta de Risco Logístico', cardX + 20, cardY + 66);

    // Animated gauge bar for 95.3% risk on Primeira Classe
    const riskFill = 0.953 * (0.88 + 0.12 * Math.sin(t * 2.2));
    this.roundRect(cardX + 20, cardY + 92, cardW - 40, 128, 10, '#292524', '#57534e');
    ctx.fillStyle = '#d6d3d1';
    ctx.font = '600 13px "IBM Plex Sans", sans-serif';
    ctx.fillText('FRETE: PRIMEIRA CLASSE → EUROPA', cardX + 36, cardY + 120);

    ctx.fillStyle = '#f87171';
    ctx.font = '700 36px "IBM Plex Mono", monospace';
    ctx.fillText('95,3%', cardX + 36, cardY + 166);
    ctx.fillStyle = '#fca5a5';
    ctx.font = '600 14px "IBM Plex Sans", sans-serif';
    ctx.fillText('risco de atraso previsto', cardX + 158, cardY + 164);

    this.drawProgressBar(cardX + 36, cardY + 186, cardW - 72, 12, riskFill, '#ef4444');

    // Financial impact metrics
    const metrics = [
      { lbl: 'MARGEM NEGATIVA ASSOCIADA', val: 'US$ 2,15M', col: '#fde047' },
      { lbl: 'BASE HISTÓRICA DATACO', val: '180.519 linhas', col: '#fafaf9' },
      { lbl: 'PRECISÃO (CLASSE 1)', val: '83,22% • 8 prod. = 84,6%', col: '#34d399' },
    ];
    metrics.forEach((m, i) => {
      const my = cardY + 240 + i * 94;
      this.roundRect(cardX + 20, my, cardW - 40, 78, 8, '#292524', '#44403c');
      ctx.fillStyle = '#a8a29e';
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      ctx.fillText(m.lbl, cardX + 36, my + 26);
      ctx.fillStyle = m.col;
      ctx.font = '700 22px "IBM Plex Mono", monospace';
      ctx.fillText(m.val, cardX + 36, my + 58);
    });

    // Slide pagination dots at bottom of right card
    for (let i = 0; i < totalSlides; i++) {
      const dx = cardX + 26 + i * 24;
      const dy = cardY + cardH - 36;
      ctx.beginPath();
      ctx.arc(dx, dy, i === idx ? 5.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = i === idx ? this.accentColor : '#57534e';
      ctx.fill();
    }
    ctx.fillStyle = '#a8a29e';
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Tela ${idx + 1}/${totalSlides}`, cardX + cardW - 22, cardY + cardH - 32);
  }

  // ---------------------------------------------------------------------------
  // Shared Drawing Helpers
  // ---------------------------------------------------------------------------
  private drawSlideCover(
    slide: LoadedSlide | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    alpha: number,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (slide && slide.loaded && slide.img) {
      const img = slide.img;
      const scale = Math.max(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = x + (w - dw) / 2;
      const dy = y + (h - dh) / 2;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      this.drawFallbackPlaceholder(x, y, w, h, slide?.label ?? this.project.title);
    }
    ctx.restore();
  }

  private drawSlideContainFaded(
    slide: LoadedSlide | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    alpha: number,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (slide && slide.loaded && slide.img) {
      this.drawSlideContain(slide, x, y, w, h);
    } else {
      this.drawFallbackPlaceholder(x, y, w, h, slide?.label ?? this.project.title);
    }
    ctx.restore();
  }

  private drawSlideContain(
    slide: LoadedSlide,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (!slide.img) return;
    const img = slide.img;
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    this.ctx.drawImage(img, dx, dy, dw, dh);
  }

  private drawFallbackPlaceholder(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#14171f';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 22px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  private drawProgressBar(
    x: number,
    y: number,
    w: number,
    h: number,
    frac: number,
    color: string,
  ): void {
    this.roundRect(x, y, w, h, h / 2, 'rgba(148, 163, 184, 0.2)');
    const fillW = Math.max(h, w * clamp(frac, 0, 1));
    this.roundRect(x, y, fillW, h, h / 2, color);
  }

  private drawCursor(
    x: number,
    y: number,
    clicking: boolean,
    clickProgress: number,
    ringColor: string,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    if (clicking) {
      const r = 8 + clamp(clickProgress, 0, 1) * 26;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 2.5 * (1 - clamp(clickProgress, 0, 1));
      ctx.stroke();
    }

    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 22);
    ctx.lineTo(6, 16.5);
    ctx.lineTo(12, 26);
    ctx.lineTo(16, 24);
    ctx.lineTo(10, 14.5);
    ctx.lineTo(18, 14.5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string,
    stroke?: string,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawWrappedText(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
  ): void {
    const ctx = this.ctx;
    const words = text.split(/\s+/);
    let line = '';
    let currentY = y;
    let lines = 0;

    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        if (lines === maxLines - 1) {
          let trimmed = `${line} ${words[i]}`;
          while (trimmed.length > 4 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
            trimmed = trimmed.slice(0, -1);
          }
          ctx.fillText(`${trimmed}…`, x, currentY);
          return;
        }
        ctx.fillText(line, x, currentY);
        line = words[i];
        currentY += lineHeight;
        lines++;
      } else {
        line = test;
      }
    }
    if (line && lines < maxLines) {
      ctx.fillText(line, x, currentY);
    }
  }

  public dispose(): void {
    this.disposed = true;
    for (const slide of this.slides) {
      slide.img = null;
    }
    this.slides.length = 0;
  }
}
