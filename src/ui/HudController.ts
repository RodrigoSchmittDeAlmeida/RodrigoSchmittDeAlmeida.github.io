import type { CarTelemetryState } from '../engine/CarController';
import type { DemoKind, PortfolioProject } from '../data/projectsData';

export interface HudCallbacks {
  onDriveToProject: (projectId: string) => void;
  onToggleTour: () => boolean;
  onToggleCameraMode: (mode: 'chase' | 'orbit') => void;
  onToggleAudio: () => boolean;
  onToggleHeadlights: () => boolean;
  onResetCar: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const CHAT_MAX_REQUESTS_PER_MINUTE = 15;
const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT_ERROR_MESSAGE =
  'Muitas mensagens enviadas em sequência. Aguarde alguns segundos e tente novamente.';

const CHAT_QUICK_SUGGESTIONS: string[] = [
  'Por que não consigo fazer transações com a Colômbia?',
  'Como funcionam o representante e os membros da empresa?',
  'Quais países, moedas e formas de envio a V-Stable suporta?',
  'Como ativar ou reconfigurar minha verificação em duas etapas?',
];

const CHAT_WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    'Olá! Sou o **Assistente Virtual da V-Stable**. Posso tirar dúvidas sobre países e moedas suportadas (como Colômbia via transferência bancária vs. carteira cripto), verificação em duas etapas, cotações e verificação de identidade (KYC). Como posso ajudar?',
};

const SCREENSHOT_CAPTIONS: Record<string, string> = {
  '01-telemetry.png': 'Telemetria em 30 FPS — Blocos Bosch ME7.5.30',
  '02-map2d.png': 'Mapa 2D — Carga × RPM × Avanço',
  '03-modules.png': 'Módulos SOLID & Protocolos KWP2000 / UDS',
  '04-fordka.png': 'Perfil Multi-Veículo — Ford HS-CAN UDS',
  '01-login.png': 'Autenticação Corporativa B2B',
  '02-transfer-dados.png': 'Transferência Internacional — Dados & Cotação',
  '03-transfer-revisao.png': 'Revisão Transparente de Taxas & IOF',
  '04-transfer-2fa.png': 'Confirmação 2FA TOTP (RFC 6238)',
  '05-historico.png': 'Histórico de Liquidações Cross-Border',
  '06-detalhes.png': 'Detalhes da Operação & Comprovante PDF',
  '07-beneficiario.png': 'Gestão de Beneficiários Bancários e Web3',
  '00-dashboard.png': 'Torre de Decisão Logística — Visão Geral',
  '01-risco-regiao.png': 'Risco Histórico de Atraso por Região',
  '02-atraso-status.png': 'Distribuição de Atrasos por Status de Entrega',
  '03-prejuizo-categoria.png': 'Prejuízo Acumulado por Categoria de Produto',
  '04-envio-real-agendado.png': 'Dias de Envio Real vs. Agendado',
  '05-paradoxo-simpson.png': 'Análise do Paradoxo de Simpson por Segmento',
  '06-prejuizo-acumulado.png': 'Prejuízo Financeiro Acumulado (USD)',
};

const ICONS = {
  tour: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  camera:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  audio:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  lights:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  reset:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  close:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  external:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  prev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
  next: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
};

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolvePublicPath(rawPath: string): string {
  const clean = rawPath.replace(/^\.\//, '').replace(/^\//, '');
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? `${base}${clean}` : `${base}/${clean}`;
}

function normalizeQuery(text: string): string {
  return text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase();
}

function containsAny(normalized: string, keywords: string[]): boolean {
  return keywords.some((kw) => normalized.includes(kw));
}

function formatChatReplyHtml(raw: string): string {
  const lines = raw.split('\n');
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      let escaped = escapeHtml(trimmed);
      escaped = escaped.replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      escaped = escaped.replaceAll(/`([^`]+)`/g, '<code>$1</code>');
      return `<p>${escaped}</p>`;
    })
    .filter(Boolean)
    .join('');
}

function generateOfflineZeroPiiReply(question: string): string {
  const normalized = normalizeQuery(question);

  if (containsAny(normalized, ['colombia', 'cop', 'bloquead', 'corredor'])) {
    return [
      'As transações bancárias diretas em **COP (Peso Colombiano)** estão indisponíveis no momento por regras de corredor de liquidação e compliance da V-Stable:',
      '**1. Motivo regulatório e grade SWIFT:** O recebimento bancário local em pesos colombianos está em liberação regulatória, e o trilho SWIFT padrão cobre 16 moedas globais sem inclusão direta do COP.',
      '**2. Como pagar um fornecedor na Colômbia hoje:**',
      '- **Wallet Cripto (Recomendada):** Cadastre o beneficiário em **Beneficiários** na modalidade Wallet Cripto nas redes `Polygon`, `Celo`, `Ethereum`, `Gnosis`, `Moonbeam` ou `Tron` para liquidar em `USDC` ou `USDT`.',
      '- **Conta Internacional em USD ou EUR:** Caso o fornecedor possua conta internacional elegível, utilize `USD` (`ACH`/`Wire`/`SWIFT`) ou `EUR` (`SEPA`/`SWIFT`).',
    ].join('\n');
  }

  if (
    containsAny(normalized, [
      'membro',
      'membros',
      'convite',
      'representante',
      'perfil',
      'perfis',
      'permiss',
      'empresa',
      'revogar',
    ])
  ) {
    return [
      'Sobre **Gestão de Membros, Perfis e Convites** na V-Stable:',
      '- **Representante:** Gestão completa da conta da empresa, envio de convites, alteração de permissões, revogação de acesso e operações financeiras.',
      '- **Membro com permissão para operar:** Realiza cotações, transferências e gestão de beneficiários.',
      '- **Membro com acesso apenas de visualização:** Acompanha saldos, histórico e comprovantes sem operar.',
      '- **Convites seguros:** Enviados por link exclusivo com aceite obrigatório dos Termos de Uso e Política de Privacidade vigentes.',
    ].join('\n');
  }

  if (
    containsAny(normalized, [
      'pais',
      'paises',
      'moeda',
      'moedas',
      'suporta',
      'formas de envio',
      'trilho',
      'ach',
      'sepa',
      'spei',
      'swift',
    ])
  ) {
    return [
      'A V-Stable opera com liquidação multi-trilho em moeda fiduciária e stablecoins (`USDC`, `USDT`, `BRLA`, `EURC`):',
      '- **Brasil (BRL):** Entrada e liquidação imediata via `PIX`.',
      '- **Estados Unidos (USD):** `ACH` (1–2 dias úteis), `Wire` (mesmo dia), `RTP` e `FedNow`.',
      '- **Zona do Euro (EUR) & Reino Unido (GBP):** `SEPA` / `SEPA Instant` e `Faster Payments`.',
      '- **América Latina:** México via `SPEI` (`MXN`) e Argentina via `CVU`/`CBU`/`ALIAS` (`ARS`).',
      '- **Grade Global SWIFT (16+ moedas):** `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `CHF`, `JPY`, `CNY`, `HKD`, `SGD`, `NZD`, `THB`, `PHP`, `INR`, `KRW` e `IDR`, além de **Wallet Cripto** global.',
    ].join('\n');
  }

  if (containsAny(normalized, ['2fa', 'totp', 'duas etapas', 'qr', 'autenticador', 'celular'])) {
    return [
      'Sobre a **Autenticação em Duas Etapas (2FA / TOTP)** na V-Stable:',
      '**1. Onde configurar:** Acesse **Configurações > Segurança da Conta** no painel lateral.',
      '**2. Troca de aparelho / novo QR Code:** O sistema exige o código atual de 6 dígitos antes de gerar o novo segredo, revogando o anterior imediatamente.',
      '**3. Uso único & proteção:** Cada código TOTP é válido uma única vez na sua janela de 30s; após **5 tentativas incorretas**, ocorre bloqueio temporário de **15 minutos**.',
    ].join('\n');
  }

  if (containsAny(normalized, ['kyc', 'kyb', 'liveness', 'documento', 'identidade'])) {
    return [
      'A **Verificação de Identidade (KYC)** acompanha o cadastro do representante:',
      'Etapas: Cadastro da Empresa (`CNPJ`) → Representante Legal → Ativação de `2FA` → Aceite dos termos do provedor → Envio de documento (até `3 MB`) e Prova de Vida (`Liveness`). É possível reiniciar a verificação caso precise corrigir arquivos.',
    ].join('\n');
  }

  return [
    'Posso ajudar com dúvidas operacionais da **V-Stable** sem expor dados sensíveis (**Zero-PII**):',
    '- **Corredores e moedas:** Colômbia (`COP` vs. Wallet Cripto), `ACH`, `Wire`, `SEPA`, `SPEI` e `SWIFT`.',
    '- **Perfis corporativos:** Representante, Operador e Visualizador.',
    '- **Segurança 2FA (TOTP):** Ativação, rotação de QR Code e bloqueio após 5 falhas.',
    '- **Cotações e KYC:** Trava de câmbio, comprovantes PDF e verificação de identidade.',
  ].join('\n');
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly projects: PortfolioProject[];
  private readonly callbacks: HudCallbacks;

  private cameraMode: 'chase' | 'orbit' = 'chase';
  private audioEnabled = false;
  private headlightsOn = true;
  private tourActive = false;

  private activeProjectModal: PortfolioProject | null = null;
  private currentProximityProject: PortfolioProject | null = null;
  private modalCleanup: (() => void) | null = null;

  private speedEl!: HTMLElement;
  private gearEl!: HTMLElement;
  private rpmReadoutEl!: HTMLElement;
  private rpmBarEl!: HTMLElement;
  private pilotBadgeEl!: HTMLElement;
  private playingBadgeEl!: HTMLElement;
  private playingLabelEl!: HTMLElement;
  private coordsEl!: HTMLElement;
  private modelStatusDotEl!: HTMLElement;
  private modelStatusLabelEl!: HTMLElement;
  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;

  private tourBtn!: HTMLButtonElement;
  private camBtn!: HTMLButtonElement;
  private audioBtn!: HTMLButtonElement;
  private lightsBtn!: HTMLButtonElement;
  private driveHintChip!: HTMLElement;
  private proximityBanner!: HTMLElement;
  private proximityTitleEl!: HTMLElement;
  private modalBackdrop!: HTMLElement;
  private modalContainer!: HTMLElement;
  private stationBtns: Map<string, HTMLButtonElement> = new Map();

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';

    if (e.key === 'Escape' && this.activeProjectModal) {
      e.preventDefault();
      this.closeProjectModal();
      return;
    }

    if (this.activeProjectModal || isTyping) {
      return;
    }

    if (!e.repeat) {
      if (e.code === 'KeyT') {
        e.preventDefault();
        this.tourActive = this.callbacks.onToggleTour();
        this.syncTourUi();
        return;
      }
      if (e.code === 'KeyC') {
        e.preventDefault();
        this.toggleCameraMode();
        return;
      }
    }

    const num = Number.parseInt(e.key, 10);
    if (num >= 1 && num <= this.projects.length) {
      const target = this.projects.find((p) => p.index === num);
      if (target) {
        this.callbacks.onDriveToProject(target.id);
      }
    }
  };

  constructor(root: HTMLElement, projects: PortfolioProject[], callbacks: HudCallbacks) {
    this.root = root;
    this.projects = projects;
    this.callbacks = callbacks;

    this.renderShell();
    this.bindEvents();
  }

  private renderShell(): void {
    const stationButtonsHtml = this.projects
      .map(
        (p) => `
          <button
            type="button"
            class="station-btn"
            data-project-id="${escapeHtml(p.id)}"
            title="Dirigir até ${escapeHtml(p.title)} (Tecla ${p.index})"
          >
            <span>${escapeHtml(p.shortName)}</span>
          </button>
        `
      )
      .join('');

    this.root.innerHTML = `
      <header class="hud-topbar">
        <div class="topbar-title">Rodrigo Schmitt — VW Gol G5</div>

        <nav class="topbar-stations" aria-label="Estações de projetos">
          ${stationButtonsHtml}
        </nav>

        <div class="topbar-controls">
          <button type="button" class="ctrl-btn" id="btn-tour" title="Alternar Tour Automático (T)">
            ${ICONS.tour}
            <span>Tour Auto</span>
          </button>
          <button type="button" class="ctrl-btn is-active" id="btn-cam-mode" title="Alternar Câmera (C)">
            ${ICONS.camera}
            <span>Câmera</span>
          </button>
          <button type="button" class="ctrl-btn" id="btn-audio" title="Ativar/Desativar Som do Motor">
            ${ICONS.audio}
            <span>Áudio</span>
          </button>
          <button type="button" class="ctrl-btn is-active" id="btn-lights" title="Ligar/Desligar Faróis (H)">
            ${ICONS.lights}
            <span>Farol</span>
          </button>
          <button type="button" class="ctrl-btn" id="btn-reset-car" title="Resetar Posição do Carro (R)">
            ${ICONS.reset}
            <span>Reset</span>
          </button>
        </div>
      </header>

      <div class="hud-center-stack">
        <div class="drive-hint-chip" id="drive-hint-chip">
          <span>Dirija com <strong>WASD</strong>, clique em uma estação ou ative o <strong>Tour Auto</strong></span>
          <button type="button" class="drive-hint-cta" id="btn-hint-audio">Ativar Áudio</button>
          <button type="button" class="icon-dismiss-btn" id="btn-hint-dismiss" aria-label="Dispensar dica">
            ${ICONS.close}
          </button>
        </div>

        <div class="proximity-banner" id="proximity-banner" role="button" tabindex="0">
          <span class="proximity-key">E</span>
          <div>
            <div class="proximity-title" id="proximity-title">Estação próxima</div>
            <div class="proximity-sub">Pressione E ou clique para abrir detalhes</div>
          </div>
        </div>
      </div>

      <footer class="bottom-hud">
        <div class="cluster-speed-gear">
          <div class="speed-box">
            <span class="speed-value" id="hud-speed">0</span>
            <span class="speed-unit">km/h</span>
          </div>
          <div class="gear-box">
            <span class="gear-label">Marcha</span>
            <span class="gear-value" id="hud-gear">N</span>
          </div>
        </div>

        <div class="cluster-telemetry">
          <div class="telemetry-top-row">
            <span class="rpm-readout" id="hud-rpm">850 RPM</span>
            <div class="telemetry-badges">
              <span class="pilot-badge" id="hud-pilot-badge">Manual</span>
              <span class="playing-badge" id="hud-playing-badge">
                <span class="playing-dot" aria-hidden="true"></span>
                <span id="hud-playing-label">Nenhuma demo ativa</span>
              </span>
            </div>
          </div>

          <div class="rpm-bar-track">
            <div class="rpm-bar-fill" id="hud-rpm-bar"></div>
          </div>

          <div class="coords-row">
            <span id="hud-coords">X 0.0m • Z 0.0m • Rumo 0°</span>
            <span class="model-status">
              <span class="model-status-dot" id="hud-model-dot"></span>
              <span id="hud-model-label">Carregando Gol G5...</span>
            </span>
          </div>
        </div>

        <div class="controls-legend" aria-label="Atalhos de teclado">
          <div class="legend-item"><span class="kbd">WASD</span> Dirigir</div>
          <div class="legend-item"><span class="kbd">Espaço</span> Drift</div>
          <div class="legend-item"><span class="kbd">T</span> Tour Auto</div>
          <div class="legend-item"><span class="kbd">C</span> Câmera</div>
          <div class="legend-item"><span class="kbd">E</span> Abrir Tela</div>
          <div class="legend-item"><span class="kbd">1–7</span> Estações</div>
        </div>

        <div class="minimap-wrap">
          <canvas id="hud-minimap" width="148" height="98" title="Clique em uma estação para dirigir até ela"></canvas>
        </div>
      </footer>

      <div class="project-modal-backdrop" id="project-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-project-title">
        <div class="project-modal" id="project-modal-container"></div>
      </div>
    `;

    this.speedEl = this.root.querySelector('#hud-speed') as HTMLElement;
    this.gearEl = this.root.querySelector('#hud-gear') as HTMLElement;
    this.rpmReadoutEl = this.root.querySelector('#hud-rpm') as HTMLElement;
    this.rpmBarEl = this.root.querySelector('#hud-rpm-bar') as HTMLElement;
    this.pilotBadgeEl = this.root.querySelector('#hud-pilot-badge') as HTMLElement;
    this.playingBadgeEl = this.root.querySelector('#hud-playing-badge') as HTMLElement;
    this.playingLabelEl = this.root.querySelector('#hud-playing-label') as HTMLElement;
    this.coordsEl = this.root.querySelector('#hud-coords') as HTMLElement;
    this.modelStatusDotEl = this.root.querySelector('#hud-model-dot') as HTMLElement;
    this.modelStatusLabelEl = this.root.querySelector('#hud-model-label') as HTMLElement;
    this.minimapCanvas = this.root.querySelector('#hud-minimap') as HTMLCanvasElement;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;

    this.tourBtn = this.root.querySelector('#btn-tour') as HTMLButtonElement;
    this.camBtn = this.root.querySelector('#btn-cam-mode') as HTMLButtonElement;
    this.audioBtn = this.root.querySelector('#btn-audio') as HTMLButtonElement;
    this.lightsBtn = this.root.querySelector('#btn-lights') as HTMLButtonElement;
    this.driveHintChip = this.root.querySelector('#drive-hint-chip') as HTMLElement;
    this.proximityBanner = this.root.querySelector('#proximity-banner') as HTMLElement;
    this.proximityTitleEl = this.root.querySelector('#proximity-title') as HTMLElement;
    this.modalBackdrop = this.root.querySelector('#project-modal-backdrop') as HTMLElement;
    this.modalContainer = this.root.querySelector('#project-modal-container') as HTMLElement;

    this.root.querySelectorAll<HTMLButtonElement>('.station-btn').forEach((btn) => {
      const id = btn.dataset.projectId;
      if (id) {
        this.stationBtns.set(id, btn);
      }
    });
  }

  private bindEvents(): void {
    this.stationBtns.forEach((btn, id) => {
      btn.addEventListener('click', () => this.callbacks.onDriveToProject(id));
    });

    this.tourBtn.addEventListener('click', () => {
      this.tourActive = this.callbacks.onToggleTour();
      this.syncTourUi();
    });

    this.camBtn.addEventListener('click', () => this.toggleCameraMode());

    const toggleAudioHandler = (): void => {
      this.audioEnabled = this.callbacks.onToggleAudio();
      this.syncAudioUi();
    };

    this.audioBtn.addEventListener('click', toggleAudioHandler);
    this.root.querySelector('#btn-hint-audio')?.addEventListener('click', toggleAudioHandler);
    this.root.querySelector('#btn-hint-dismiss')?.addEventListener('click', () => {
      this.driveHintChip.classList.add('is-hidden');
    });

    this.lightsBtn.addEventListener('click', () => {
      this.headlightsOn = this.callbacks.onToggleHeadlights();
      this.syncHeadlightsUi();
    });

    this.root.querySelector('#btn-reset-car')?.addEventListener('click', () => {
      this.callbacks.onResetCar();
    });

    this.proximityBanner.addEventListener('click', () => {
      if (this.currentProximityProject) {
        this.openProjectModal(this.currentProximityProject);
      }
    });

    this.proximityBanner.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && this.currentProximityProject) {
        e.preventDefault();
        this.openProjectModal(this.currentProximityProject);
      }
    });

    this.modalBackdrop.addEventListener('click', (ev) => {
      if (ev.target === this.modalBackdrop) {
        this.closeProjectModal();
      }
    });

    this.minimapCanvas.addEventListener('click', (ev) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const clickX = ev.clientX - rect.left;
      const clickY = ev.clientY - rect.top;

      let closest: PortfolioProject | null = null;
      let bestDist = 18;
      for (const project of this.projects) {
        const pt = this.worldToMinimap(project.worldPos.x, project.worldPos.z);
        const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
        if (dist < bestDist) {
          bestDist = dist;
          closest = project;
        }
      }
      if (closest) {
        this.callbacks.onDriveToProject(closest.id);
      }
    });

    window.addEventListener('keydown', this.handleKeyDown);
  }

  private toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'chase' ? 'orbit' : 'chase';
    this.camBtn.classList.toggle('is-active', this.cameraMode === 'chase');
    const labelSpan = this.camBtn.querySelector('span');
    if (labelSpan) {
      labelSpan.textContent = this.cameraMode === 'chase' ? 'Câmera' : 'Órbita';
    }
    this.callbacks.onToggleCameraMode(this.cameraMode);
  }

  public setAudioEnabledState(enabled: boolean): void {
    this.audioEnabled = enabled;
    this.syncAudioUi();
  }

  private syncTourUi(): void {
    this.tourBtn.classList.toggle('is-active', this.tourActive);
  }

  private syncAudioUi(): void {
    this.audioBtn.classList.toggle('is-active', this.audioEnabled);
    if (this.audioEnabled) {
      this.driveHintChip.classList.add('is-hidden');
    }
  }

  private syncHeadlightsUi(): void {
    this.lightsBtn.classList.toggle('is-active', this.headlightsOn);
  }

  public updateTelemetry(t: CarTelemetryState): void {
    this.speedEl.textContent = `${Math.round(Math.abs(t.speedKmh))}`;
    this.gearEl.textContent = t.gear;

    const clampedRpm = Math.max(850, Math.min(6800, Math.round(t.rpm)));
    this.rpmReadoutEl.textContent = `${clampedRpm} RPM`;
    const rpmPct = ((clampedRpm - 850) / (6800 - 850)) * 100;
    this.rpmBarEl.style.width = `${Math.max(5, Math.min(100, rpmPct)).toFixed(1)}%`;

    this.coordsEl.textContent = `X ${t.posX.toFixed(1)}m • Z ${t.posZ.toFixed(1)}m • Rumo ${Math.round(t.headingDeg)}°`;

    // Pilot mode badge
    const isTour = t.autopilotMode === 'tour';
    if (isTour !== this.tourActive) {
      this.tourActive = isTour;
      this.syncTourUi();
    }

    if (t.autopilotMode === 'tour') {
      const target = this.projects.find((p) => p.id === t.autopilotTargetId);
      this.pilotBadgeEl.textContent = target ? `Tour Auto • ${target.shortName}` : 'Tour Auto';
      this.pilotBadgeEl.classList.add('is-auto');
    } else if (t.autopilotMode === 'goto') {
      const target = this.projects.find((p) => p.id === t.autopilotTargetId);
      this.pilotBadgeEl.textContent = target ? `Indo até ${target.shortName}` : 'Piloto Auto';
      this.pilotBadgeEl.classList.add('is-auto');
    } else {
      this.pilotBadgeEl.textContent = 'Manual';
      this.pilotBadgeEl.classList.remove('is-auto');
    }

    // Active playing 3D screens badge
    if (t.activePlayingIds.length > 0) {
      const names = t.activePlayingIds
        .map((id) => this.projects.find((p) => p.id === id)?.shortName ?? id)
        .join(', ');
      this.playingLabelEl.textContent = `Reproduzindo: ${names}`;
      this.playingBadgeEl.classList.add('is-playing');
    } else {
      this.playingLabelEl.textContent = 'Demos em espera';
      this.playingBadgeEl.classList.remove('is-playing');
    }

    if (t.headlightsOn !== this.headlightsOn) {
      this.headlightsOn = t.headlightsOn;
      this.syncHeadlightsUi();
    }

    this.modelStatusDotEl.classList.toggle('is-ready', t.modelLoaded);
    this.modelStatusLabelEl.textContent = t.modelLoaded
      ? 'Gol G5 pronto'
      : 'Carregando Gol G5...';

    this.stationBtns.forEach((btn, id) => {
      btn.classList.toggle('is-near', t.nearestProjectId === id);
      btn.classList.toggle('is-target', t.autopilotTargetId === id && t.autopilotMode !== 'manual');
    });

    this.renderMinimap(t);
  }

  public setProximity(project: PortfolioProject | null, dist: number): void {
    this.currentProximityProject = project;
    if (!project) {
      this.proximityBanner.classList.remove('is-visible');
      return;
    }

    this.proximityTitleEl.textContent = `${project.title} (${dist.toFixed(1)}m)`;
    this.proximityBanner.classList.add('is-visible');
  }

  private worldToMinimap(wx: number, wz: number): { x: number; y: number } {
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const nx = (wx + 28) / 56;
    const ny = (wz - 16) / -242; // bottom (+16) -> top (-226)
    return {
      x: Math.max(8, Math.min(w - 8, nx * w)),
      y: Math.max(8, Math.min(h - 8, h - ny * (h - 16) - 8)),
    };
  }

  private renderMinimap(t: CarTelemetryState): void {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle coordinate grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 24; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 20; y < h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Main track spine
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const startPt = this.worldToMinimap(0, 4);
    const endPt = this.worldToMinimap(0, -214);
    ctx.moveTo(startPt.x, startPt.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();

    // 7 station markers
    for (const project of this.projects) {
      const pt = this.worldToMinimap(project.worldPos.x, project.worldPos.z);
      const isFocused =
        t.nearestProjectId === project.id ||
        (t.autopilotMode !== 'manual' && t.autopilotTargetId === project.id);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isFocused ? 4.5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = isFocused ? '#d98f4e' : '#8b909a';
      ctx.fill();

      if (isFocused) {
        ctx.strokeStyle = '#f2f3f5';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Gol G5 directional triangle
    const carPt = this.worldToMinimap(t.posX, t.posZ);
    const rad = ((t.headingDeg - 90) * Math.PI) / 180;
    ctx.save();
    ctx.translate(carPt.x, carPt.y);
    ctx.rotate(rad);
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -3.5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 3.5);
    ctx.closePath();
    ctx.fillStyle = '#d98f4e';
    ctx.fill();
    ctx.strokeStyle = '#f2f3f5';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  public openProjectModal(project: PortfolioProject): void {
    this.cleanupModal();
    this.activeProjectModal = project;
    document.body.dataset.modalOpen = 'true';

    const metricsHtml = project.metrics
      .map(
        (m) => `
          <div class="metrics-list-item">
            <dt>${escapeHtml(m.label)}</dt>
            <dd>${escapeHtml(m.value)}</dd>
          </div>
        `
      )
      .join('');

    const techHtml = project.technologies
      .map((tech) => `<li class="tech-item">${escapeHtml(tech)}</li>`)
      .join('');

    this.modalContainer.innerHTML = `
      <div class="modal-header">
        <div class="modal-title-group">
          <h2 class="modal-title" id="modal-project-title">${escapeHtml(project.title)}</h2>
          <div class="modal-subtitle">${escapeHtml(project.subtitle)}</div>
        </div>
        <div class="modal-header-actions">
          <a
            class="repo-link-btn"
            href="${escapeHtml(project.repoUrl)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Abrir Repositório</span>
            ${ICONS.external}
          </a>
          <button type="button" class="modal-close-btn" id="btn-modal-close">
            ${ICONS.close}
            <span>Fechar</span>
          </button>
        </div>
      </div>

      <div class="modal-body">
        <div class="modal-col-left">
          <div class="meta-line">
            <span>${escapeHtml(project.category)}</span>
            <span class="meta-sep" aria-hidden="true">•</span>
            <span>${escapeHtml(project.period)}</span>
            <span class="meta-sep" aria-hidden="true">•</span>
            <span>Rodrigo Schmitt de Almeida</span>
          </div>

          <dl class="metrics-list">${metricsHtml}</dl>

          <section class="dossier-section">
            <h3>O que faz</h3>
            <p>${escapeHtml(project.whatItDoes)}</p>
          </section>

          <section class="dossier-section">
            <h3>Arquitetura</h3>
            <p>${escapeHtml(project.architecture)}</p>
          </section>

          <section class="dossier-section">
            <h3>Tecnologias</h3>
            <ul class="tech-list">${techHtml}</ul>
          </section>
        </div>

        <div class="modal-col-right" id="modal-right-host"></div>
      </div>
    `;

    this.modalContainer
      .querySelector('#btn-modal-close')
      ?.addEventListener('click', () => this.closeProjectModal());

    const rightHost = this.modalContainer.querySelector('#modal-right-host') as HTMLElement;
    if (project.isChatbot) {
      this.mountChatbotSimulator(rightHost);
    } else if (project.screenshots.length > 0) {
      this.mountScreenshotCarousel(rightHost, project);
    } else {
      this.mountAnimatedFlowCanvas(rightHost, project.demoKind, project.title);
    }

    this.modalBackdrop.classList.add('is-open');
  }

  public closeProjectModal(): void {
    this.cleanupModal();
    this.activeProjectModal = null;
    delete document.body.dataset.modalOpen;
    this.modalBackdrop.classList.remove('is-open');
    this.modalContainer.innerHTML = '';
  }

  private cleanupModal(): void {
    if (this.modalCleanup) {
      this.modalCleanup();
      this.modalCleanup = null;
    }
  }

  // ==========================================================================
  // CLEAN GALLERY CAROUSEL (for projects with real screenshots, NO sim buttons)
  // ==========================================================================
  private mountScreenshotCarousel(host: HTMLElement, project: PortfolioProject): void {
    const slides = project.screenshots.map((src) => {
      const fileName = src.split('/').pop() ?? '';
      return {
        url: resolvePublicPath(src),
        caption: SCREENSHOT_CAPTIONS[fileName] ?? project.title,
      };
    });

    let currentIdx = 0;
    let progress = 0;
    const SLIDE_DURATION_MS = 3800;

    const dotsHtml = slides
      .map(
        (s, idx) =>
          `<button type="button" class="viewer-dot ${idx === 0 ? 'is-active' : ''}" data-slide-idx="${idx}" aria-label="Tela ${idx + 1}: ${escapeHtml(s.caption)}"></button>`
      )
      .join('');

    host.innerHTML = `
      <div class="viewer-shell">
        <div class="viewer-head">
          <div class="viewer-caption" id="viewer-caption">${escapeHtml(slides[0].caption)}</div>
          <div class="viewer-counter" id="viewer-counter">1 / ${slides.length}</div>
        </div>

        <div class="viewer-stage">
          <img
            class="viewer-image"
            id="viewer-image"
            src="${escapeHtml(slides[0].url)}"
            alt="${escapeHtml(slides[0].caption)}"
          />
        </div>

        <div class="viewer-progress-track">
          <div class="viewer-progress-fill" id="viewer-progress-fill"></div>
        </div>

        <div class="viewer-foot">
          <div class="viewer-dots">${dotsHtml}</div>
          <div class="viewer-nav-group">
            <button type="button" class="viewer-nav-btn" id="viewer-prev" aria-label="Tela anterior">
              ${ICONS.prev}
            </button>
            <button type="button" class="viewer-nav-btn" id="viewer-next" aria-label="Próxima tela">
              ${ICONS.next}
            </button>
          </div>
        </div>
      </div>
    `;

    const captionEl = host.querySelector('#viewer-caption') as HTMLElement;
    const counterEl = host.querySelector('#viewer-counter') as HTMLElement;
    const imgEl = host.querySelector('#viewer-image') as HTMLImageElement;
    const progressEl = host.querySelector('#viewer-progress-fill') as HTMLElement;
    const dotBtns = Array.from(host.querySelectorAll<HTMLButtonElement>('.viewer-dot'));

    const showSlide = (idx: number): void => {
      currentIdx = (idx + slides.length) % slides.length;
      progress = 0;
      const slide = slides[currentIdx];
      imgEl.src = slide.url;
      imgEl.alt = slide.caption;
      captionEl.textContent = slide.caption;
      counterEl.textContent = `${currentIdx + 1} / ${slides.length}`;
      progressEl.style.width = '0%';
      dotBtns.forEach((btn, i) => btn.classList.toggle('is-active', i === currentIdx));
    };

    dotBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number.parseInt(btn.dataset.slideIdx ?? '0', 10);
        showSlide(idx);
      });
    });

    host.querySelector('#viewer-prev')?.addEventListener('click', () => showSlide(currentIdx - 1));
    host.querySelector('#viewer-next')?.addEventListener('click', () => showSlide(currentIdx + 1));

    let rafId = 0;
    let lastTime = performance.now();
    const tick = (now: number): void => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(100, now - lastTime);
      lastTime = now;
      progress += dt;
      if (progress >= SLIDE_DURATION_MS) {
        showSlide(currentIdx + 1);
      } else {
        progressEl.style.width = `${((progress / SLIDE_DURATION_MS) * 100).toFixed(1)}%`;
      }
    };

    rafId = requestAnimationFrame(tick);
    this.modalCleanup = () => cancelAnimationFrame(rafId);
  }

  // ==========================================================================
  // CLEAN VISUAL FLOW VIEWER (for Vincula, OrdoVitae, T2IA — NO sim buttons)
  // ==========================================================================
  private mountAnimatedFlowCanvas(host: HTMLElement, kind: DemoKind, title: string): void {
    const caption =
      kind === 'vincula'
        ? 'Fluxo do Grafo Investigativo (@neo4j-nvl/react)'
        : kind === 'ordovitae'
          ? 'Fluxo Clínico SWALIS + Validação Literal DeepSeek-V3'
          : 'Evolução Genética (BLX-α) & Mapa de Ativação tanh 3×3';

    host.innerHTML = `
      <div class="viewer-shell">
        <div class="viewer-head">
          <div class="viewer-caption">${escapeHtml(caption)}</div>
          <div class="viewer-counter">${escapeHtml(title)}</div>
        </div>
        <div class="viewer-stage">
          <canvas class="viewer-canvas" id="flow-preview-canvas" width="760" height="480"></canvas>
        </div>
      </div>
    `;

    const canvas = host.querySelector('#flow-preview-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const startMs = performance.now();
    let rafId = 0;

    const drawFrame = (now: number): void => {
      rafId = requestAnimationFrame(drawFrame);
      const t = (now - startMs) / 1000;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (kind === 'vincula') {
        this.drawVinculaPreview(ctx, w, h, t);
      } else if (kind === 'ordovitae') {
        this.drawOrdoVitaePreview(ctx, w, h, t);
      } else {
        this.drawT2iaPreview(ctx, w, h, t);
      }
    };

    rafId = requestAnimationFrame(drawFrame);
    this.modalCleanup = () => cancelAnimationFrame(rafId);
  }

  private drawVinculaPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, w, h);

    // Header bar (#1A2128 with #FF5D00 brand accent)
    ctx.fillStyle = '#1a2128';
    ctx.fillRect(0, 0, w, 46);
    ctx.fillStyle = '#ff5d00';
    ctx.fillRect(0, 44, w, 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 14px "Space Grotesk", sans-serif';
    ctx.fillText('Vincula • Análise de Vínculos (/casos/409/vinculos)', 18, 28);

    const nodes = [
      { x: w * 0.5, y: h * 0.52, r: 28, color: '#e04141', label: 'Investigado Principal', sub: 'CPF •••.412.880-••' },
      { x: w * 0.25, y: h * 0.34, r: 21, color: '#f0ad4e', label: 'Banco do Brasil', sub: 'Ag 4546 • SIMBA' },
      { x: w * 0.76, y: h * 0.36, r: 21, color: '#f0ad4e', label: 'Empresa Parceira', sub: 'CNPJ 14.882.•••' },
      { x: w * 0.28, y: h * 0.75, r: 19, color: '#007bff', label: 'SITTEL_ERB.csv', sub: '248 chamadas' },
      { x: w * 0.73, y: h * 0.75, r: 19, color: '#007bff', label: 'RIF_COAF_09.xlsx', sub: '14 alertas' },
    ];

    const pulse = (Math.sin(t * 2.2) + 1) * 0.5;

    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[0];
      const b = nodes[i];
      ctx.strokeStyle = i === 1 || i === 2 ? '#64748b' : '#94a3b8';
      ctx.lineWidth = i === 1 ? 3.2 : 2.0;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Travelling token along edge
      const px = a.x + (b.x - a.x) * ((t * 0.4 + i * 0.23) % 1);
      const py = a.y + (b.y - a.y) * ((t * 0.4 + i * 0.23) % 1);
      ctx.fillStyle = '#ff5d00';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + (i === 0 ? pulse * 1.5 : 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = '#1a2128';
      ctx.font = '600 12px "IBM Plex Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + n.r + 18);
      ctx.fillStyle = '#475569';
      ctx.font = '400 11px "IBM Plex Mono", monospace';
      ctx.fillText(n.sub, n.x, n.y + n.r + 33);
    }
    ctx.textAlign = 'left';
  }

  private drawOrdoVitaePreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    ctx.fillStyle = '#17191e';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#e8eaef';
    ctx.font = '600 15px "Space Grotesk", sans-serif';
    ctx.fillText('OrdoVitae • Fila Cirúrgica SWALIS + DeepSeek-V3', 22, 34);
    ctx.fillStyle = '#9aa1ae';
    ctx.font = '400 12px "IBM Plex Mono", monospace';
    ctx.fillText('941 pacientes  •  988 chamadas (-63% cache)  •  $0.0699  •  0% alucinação', 22, 56);

    const rows = [
      { tier: 'A1', color: '#dc4b3e', name: 'Paciente #412 • Colecistectomia', note: 'Achado literal: "internação prévia em UPA 48h"', score: 94 },
      { tier: 'A2', color: '#e07a34', name: 'Paciente #903 • Artroplastia Quadril', note: 'Achado literal: "3 atendimentos em UPA"', score: 86 },
      { tier: 'B', color: '#d49b35', name: 'Paciente #218 • Hernioplastia', note: 'Achado literal: "retorno ao Pronto-Socorro"', score: 67 },
      { tier: 'C', color: '#4d82c4', name: 'Paciente #789 • Eletivo Regular', note: 'Sem sinais agudos no prontuário', score: 34 },
    ];

    const activeIdx = Math.floor(t / 2.2) % rows.length;
    rows.forEach((row, idx) => {
      const y = 84 + idx * 88;
      const isFocused = idx === activeIdx;

      ctx.fillStyle = isFocused ? '#23262e' : '#1c1f26';
      ctx.fillRect(22, y, w - 44, 72);
      ctx.strokeStyle = isFocused ? '#d98f4e' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(22, y, w - 44, 72);

      ctx.fillStyle = row.color;
      ctx.fillRect(36, y + 16, 42, 24);
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(row.tier, 57, y + 32);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#eef0f4';
      ctx.font = '600 13px "IBM Plex Sans", sans-serif';
      ctx.fillText(row.name, 92, y + 28);

      ctx.fillStyle = '#9aa1ae';
      ctx.font = '400 12px "IBM Plex Sans", sans-serif';
      ctx.fillText(row.note, 92, y + 50);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#d98f4e';
      ctx.font = '600 14px "IBM Plex Mono", monospace';
      ctx.fillText(`SWALIS ${row.score}`, w - 38, y + 38);
      ctx.textAlign = 'left';
    });
  }

  private drawT2iaPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    ctx.fillStyle = '#f5f6f8';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#0f172a';
    ctx.font = '600 15px "Space Grotesk", sans-serif';
    ctx.fillText('T2IA (src/app.py) • MLP 9-18-9 + Algoritmo Genético BLX-α vs Minimax', 22, 34);

    // Left panel: Tic-Tac-Toe 3x3 board
    const bx = 42;
    const by = 78;
    const cell = 84;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, cell * 3, cell * 3);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(bx + i * cell, by);
      ctx.lineTo(bx + i * cell, by + cell * 3);
      ctx.moveTo(bx, by + i * cell);
      ctx.lineTo(bx + cell * 3, by + i * cell);
      ctx.stroke();
    }

    const moves: Array<{ idx: number; sym: 'X' | 'O' }> = [
      { idx: 4, sym: 'X' },
      { idx: 0, sym: 'O' },
      { idx: 2, sym: 'X' },
      { idx: 6, sym: 'O' },
      { idx: 3, sym: 'X' },
      { idx: 5, sym: 'O' },
    ];
    const visibleMoves = 2 + (Math.floor(t * 0.9) % (moves.length - 1));
    ctx.font = '700 38px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let m = 0; m < visibleMoves; m++) {
      const mv = moves[m];
      const r = Math.floor(mv.idx / 3);
      const c = mv.idx % 3;
      ctx.fillStyle = mv.sym === 'X' ? '#2563eb' : '#dc2626';
      ctx.fillText(mv.sym, bx + c * cell + cell / 2, by + r * cell + cell / 2);
    }

    // Right top: tanh 3x3 heatmap
    const hx = 356;
    const hy = 78;
    const hcell = 44;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#334155';
    ctx.font = '600 12px "IBM Plex Sans", sans-serif';
    ctx.fillText('Saídas MLP (tanh -1..+1)', hx, hy - 10);
    const vals = [-0.82, 0.41, 0.78, 0.64, 0.95, 0.12, -0.71, 0.36, -0.18];
    for (let i = 0; i < 9; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      const v = vals[i];
      ctx.fillStyle = v > 0.5 ? '#bbf7d0' : v > 0 ? '#e2e8f0' : '#fecaca';
      ctx.fillRect(hx + c * hcell, hy + r * hcell, hcell - 4, hcell - 4);
      ctx.fillStyle = '#0f172a';
      ctx.font = '500 11px "IBM Plex Mono", monospace';
      ctx.fillText(v.toFixed(2), hx + c * hcell + 5, hy + r * hcell + 25);
    }

    // Right bottom: Fitness evolution curve
    const gx = 356;
    const gy = 256;
    const gw = 360;
    const gh = 160;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.fillStyle = '#334155';
    ctx.font = '600 12px "IBM Plex Sans", sans-serif';
    ctx.fillText('Curva de Fitness AG (Gen 1 → 100)', gx + 10, gy + 20);

    const progress = (t * 0.25) % 1;
    const steps = Math.max(2, Math.floor(progress * 40));
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / 40;
      const x = gx + 14 + u * (gw - 28);
      const y = gy + gh - 18 - (1 - Math.exp(-u * 4.2)) * (gh - 52);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ==========================================================================
  // INTERACTIVE V-STABLE CHATBOT SIMULATOR (SupportChatWidget.tsx faithful)
  // ==========================================================================
  private mountChatbotSimulator(host: HTMLElement): void {
    const messages: ChatMessage[] = [CHAT_WELCOME_MESSAGE];
    const requestTimestamps: number[] = [];
    let isLoading = false;
    let cooldownSeconds = 0;
    let rateErrorVisible = false;
    let replyTimerId: number | null = null;
    let cooldownIntervalId: number | null = null;

    host.innerHTML = `
      <div class="chatbot-shell">
        <div class="chatbot-head">
          <div class="chatbot-title-wrap">
            <div>
              <div class="chatbot-title">Assistente V-Stable</div>
              <div class="chatbot-meta">Fallback offline Zero-PII • Heurísticas de Nielsen</div>
            </div>
          </div>
          <div class="chatbot-head-right">
            <span class="chatbot-quota" id="chat-quota-label">0/${CHAT_MAX_REQUESTS_PER_MINUTE} req/min</span>
            <button type="button" class="chatbot-clear-btn" id="chat-clear-btn">Limpar</button>
          </div>
        </div>

        <div class="chatbot-messages" id="chat-messages" aria-live="polite"></div>

        <div class="chatbot-suggestions" id="chat-suggestions">
          <div class="chatbot-suggestions-label">Perguntas rápidas:</div>
          <div class="chatbot-suggestions-grid">
            ${CHAT_QUICK_SUGGESTIONS.map(
              (q) =>
                `<button type="button" class="chatbot-suggestion-btn" data-chat-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`
            ).join('')}
          </div>
        </div>

        <div class="chatbot-rate-alert" id="chat-rate-alert" role="alert" hidden>
          ${CHAT_RATE_LIMIT_ERROR_MESSAGE}
        </div>

        <form class="chatbot-form" id="chat-form">
          <input
            type="text"
            class="chatbot-input"
            id="chat-input"
            maxlength="500"
            placeholder="Digite sua dúvida sobre a V-Stable..."
            aria-label="Pergunta para o Assistente V-Stable"
          />
          <span
            class="chatbot-cooldown-timer"
            id="chat-cooldown-timer"
            role="timer"
            aria-live="polite"
            hidden
          >0s</span>
          <button type="submit" class="chatbot-send-btn" id="chat-send-btn">Enviar</button>
        </form>
      </div>
    `;

    const messagesEl = host.querySelector('#chat-messages') as HTMLElement;
    const quotaEl = host.querySelector('#chat-quota-label') as HTMLElement;
    const clearBtn = host.querySelector('#chat-clear-btn') as HTMLButtonElement;
    const suggestionBtns = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.chatbot-suggestion-btn')
    );
    const rateAlertEl = host.querySelector('#chat-rate-alert') as HTMLElement;
    const formEl = host.querySelector('#chat-form') as HTMLFormElement;
    const inputEl = host.querySelector('#chat-input') as HTMLInputElement;
    const cooldownEl = host.querySelector('#chat-cooldown-timer') as HTMLElement;
    const sendBtn = host.querySelector('#chat-send-btn') as HTMLButtonElement;

    const pruneTimestamps = (): number[] => {
      const now = Date.now();
      while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= CHAT_RATE_LIMIT_WINDOW_MS) {
        requestTimestamps.shift();
      }
      return requestTimestamps;
    };

    const syncControls = (): void => {
      pruneTimestamps();
      quotaEl.textContent = `${requestTimestamps.length}/${CHAT_MAX_REQUESTS_PER_MINUTE} req/min`;

      const coolingDown = cooldownSeconds > 0;
      cooldownEl.hidden = !coolingDown;
      cooldownEl.textContent = `${cooldownSeconds}s`;
      rateAlertEl.hidden = !(rateErrorVisible && coolingDown);

      inputEl.disabled = isLoading;
      sendBtn.disabled = isLoading || coolingDown || inputEl.value.trim().length === 0;
      suggestionBtns.forEach((btn) => {
        btn.disabled = isLoading || coolingDown;
      });
    };

    const renderMessages = (): void => {
      const itemsHtml = messages
        .map(
          (msg) => `
            <div class="chat-row ${msg.role === 'user' ? 'is-user' : 'is-assistant'}">
              <div class="chat-bubble">${formatChatReplyHtml(msg.content)}</div>
            </div>
          `
        )
        .join('');

      const typingHtml = isLoading
        ? `
          <div class="chat-row is-assistant">
            <div class="chat-typing" role="status">
              <span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
              <span>Analisando sua dúvida...</span>
            </div>
          </div>
        `
        : '';

      messagesEl.innerHTML = itemsHtml + typingHtml;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      syncControls();
    };

    const startCooldown = (seconds: number): void => {
      cooldownSeconds = Math.max(1, seconds);
      rateErrorVisible = true;
      if (cooldownIntervalId !== null) {
        window.clearInterval(cooldownIntervalId);
      }
      cooldownIntervalId = window.setInterval(() => {
        cooldownSeconds -= 1;
        if (cooldownSeconds <= 0) {
          cooldownSeconds = 0;
          rateErrorVisible = false;
          if (cooldownIntervalId !== null) {
            window.clearInterval(cooldownIntervalId);
            cooldownIntervalId = null;
          }
        }
        syncControls();
      }, 1000);
      syncControls();
    };

    const sendQuestion = (rawText: string): void => {
      const trimmed = rawText.trim();
      if (!trimmed || isLoading || cooldownSeconds > 0) return;

      const active = pruneTimestamps();
      if (active.length >= CHAT_MAX_REQUESTS_PER_MINUTE) {
        const retrySec = Math.max(
          1,
          Math.ceil((active[0] + CHAT_RATE_LIMIT_WINDOW_MS - Date.now()) / 1000)
        );
        startCooldown(retrySec);
        return;
      }

      requestTimestamps.push(Date.now());
      messages.push({ role: 'user', content: trimmed });
      inputEl.value = '';
      isLoading = true;
      rateErrorVisible = false;
      renderMessages();

      replyTimerId = window.setTimeout(() => {
        replyTimerId = null;
        isLoading = false;
        messages.push({
          role: 'assistant',
          content: generateOfflineZeroPiiReply(trimmed),
        });
        renderMessages();
      }, 420);
    };

    suggestionBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.chatQ ?? '';
        sendQuestion(q);
      });
    });

    inputEl.addEventListener('input', () => syncControls());

    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      sendQuestion(inputEl.value);
    });

    clearBtn.addEventListener('click', () => {
      if (replyTimerId !== null) {
        window.clearTimeout(replyTimerId);
        replyTimerId = null;
      }
      messages.splice(0, messages.length, CHAT_WELCOME_MESSAGE);
      isLoading = false;
      rateErrorVisible = false;
      inputEl.value = '';
      renderMessages();
    });

    renderMessages();

    this.modalCleanup = () => {
      if (replyTimerId !== null) {
        window.clearTimeout(replyTimerId);
      }
      if (cooldownIntervalId !== null) {
        window.clearInterval(cooldownIntervalId);
      }
    };
  }

  public dispose(): void {
    this.cleanupModal();
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
