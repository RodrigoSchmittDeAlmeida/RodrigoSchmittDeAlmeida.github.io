import type { CarTelemetryState } from '../engine/CarController';
import type { CameraMode } from '../engine/SceneManager';
import type { DemoKind, PortfolioProject } from '../data/projectsData';

export interface HudCallbacks {
  onDriveToProject: (projectId: string) => void;
  onToggleTour: () => boolean;
  onToggleCameraMode: (mode: CameraMode) => void;
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

interface PokemonDialogEntry {
  speaker: string;
  badge: string;
  accentColor?: string;
  caption: string;
  tips: string[];
}

const POKEMON_GAMEPLAY_TIPS: PokemonDialogEntry[] = [
  {
    speaker: 'RODRIGO • GUIA DO GOL G5',
    badge: 'DICA 1/5 • COMO JOGAR',
    caption:
      'Bem-vindo ao meu portfólio 3D no Minecraft! Use [WASD] ou [Setas] para dirigir o Gol G5 Preto pela avenida de pedra, ou pressione [T] (Tour Auto) para o carro visitar todas as 7 estações sozinho!',
    tips: ['[WASD] Dirigir', '[T] Tour Auto', '[1–7] Ir à Estação', '[N] Próxima Dica'],
  },
  {
    speaker: 'COCKPIT VW GOL G5 1.6',
    badge: 'DICA 2/5 • 1ª PESSOA',
    caption:
      'Quer dirigir de dentro do Gol G5 vendo o painel e o volante girando para o lado certo? Pressione [V] ou [C] para entrar na CÂMERA EM 1ª PESSOA e arraste o mouse para olhar ao redor!',
    tips: ['[V] 1ª Pessoa', '[C] Trocar Câmera', '[Mouse] Olhar', '[B] Buzina'],
  },
  {
    speaker: 'TELÕES INTERATIVOS 3D',
    badge: 'DICA 3/5 • VÍDEO POR OLHAR',
    caption:
      'Pare o Gol G5 na baia de qualquer projeto e olhe para o telão: o vídeo demonstrativo roda automaticamente enquanto você estiver olhando! Aperte [E] ou clique no telão para abrir o simulador completo.',
    tips: ['[Olhar] Roda Vídeo', '[E] Abrir Projeto', '[Clique] Interagir', '[Esc] Fechar'],
  },
  {
    speaker: 'RADAR & TELETRANSPORTE',
    badge: 'DICA 4/5 • NAVEGAÇÃO RÁPIDA',
    caption:
      'Cada projeto tem uma cor única no minimapa (canto inferior direito) e no menu superior. Clique em qualquer ponto colorido do radar ou aperte as teclas [1] a [7] para o piloto automático levar você até lá!',
    tips: ['[1–7] Piloto Auto', '[Minimapa] Clicar', '[R] Resetar Carro', '[H] Faróis'],
  },
  {
    speaker: 'FÍSICA & DRIFT',
    badge: 'DICA 5/5 • CONTROLES',
    caption:
      'Segure [Shift] para ativar o Turbo na reta principal e pressione [Espaço] nas curvas para puxar o freio de mão, soltar fumaça dos pneus e fazer drift com o Gol G5!',
    tips: ['[Espaço] Drift & Fumaça', '[Shift] Turbo', '[Áudio] Som do Motor', '[N] Próxima Dica'],
  },
];

const POKEMON_STATION_DIALOGS: Record<string, { speaker: string; caption: string }> = {
  leitorECU: {
    speaker: 'ESTAÇÃO #1 • LEITORECU (GOL G5)',
    caption:
      'Você chegou ao leitorECU! Este datalogger automotivo lê a injeção Bosch ME7.5.30 do Gol G5 via KWP2000/OBD2 a 30 FPS. Olhe para o telão para ver o vídeo da telemetria ou aperte [E] para abrir!',
  },
  vstable: {
    speaker: 'ESTAÇÃO #2 • V-STABLE FINTECH',
    caption:
      'Esta é a V-Stable! Plataforma B2B de remessas internacionais e tesouraria multi-moeda (PIX, SWIFT, ACH, SEPA e Stablecoins com 2FA TOTP). Olhe para o telão ou pressione [E] para inspecionar as telas reais!',
  },
  chatbot: {
    speaker: 'ESTAÇÃO #3 • V-STABLE CHATBOT IA',
    caption:
      'Você está no Assistente Virtual IA da V-Stable! Ele responde dúvidas de corredores (como Colômbia/COP vs. Wallet Cripto) e 2FA com arquitetura Zero-PII. Aperte [E] para conversar com o Chatbot ao vivo!',
  },
  vincula: {
    speaker: 'ESTAÇÃO #4 • VINCULA (GRAFO AGES)',
    caption:
      'Bem-vindo ao Vincula! Projeto desenvolvido na AGES com Grafo Interativo de Rede de Apoio e Pareamento Clínico em tempo real. Olhe para o telão para ver o grafo em ação ou pressione [E]!',
  },
  ordovitae: {
    speaker: 'ESTAÇÃO #5 • ORDOVITAE (HACKATONA)',
    caption:
      'Este é o OrdoVitae, desenvolvido na Hackatona! Sistema de triagem clínica e priorização médica assistida por IA com protocolo Manchester. Olhe para o telão ou aperte [E] para testar a fila médica!',
  },
  t2ia: {
    speaker: 'ESTAÇÃO #6 • T2IA (REDE NEURAL & AG)',
    caption:
      'Trabalho de Inteligência Artificial (T2IA): Flappy Bird jogado por 50 agentes evoluindo via Algoritmo Genético e Rede Neural MLP construída do zero! Olhe para o telão ou aperte [E] para ver as gerações!',
  },
  smarttalent: {
    speaker: 'ESTAÇÃO #7 • SMART TALENT ANALYTICS',
    caption:
      'Estação final: Smart Talent! Torre de decisão logística sobre 180 mil pedidos reais investigando atrasos e o Paradoxo de Simpson. Olhe para o telão ou pressione [E] para explorar os 7 gráficos!',
  },
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
  tips: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
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

  private cameraMode: CameraMode = 'chase';
  private audioEnabled = false;
  private headlightsOn = false;
  private tourActive = false;

  private activeProjectModal: PortfolioProject | null = null;
  private currentProximityProject: PortfolioProject | null = null;
  private currentProximityDist = 0;
  private lastNarratedStationId: string | null = null;
  private modalCleanup: (() => void) | null = null;

  private tipsDismissed = false;
  private pokemonTipIndex = 0;
  private pokemonTypingTimer: number | null = null;
  private pokemonCurrentFullText = '';
  private pokemonCurrentCharIdx = 0;
  private pokemonIsTyping = false;

  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private speedoCanvas!: HTMLCanvasElement;
  private speedoCtx!: CanvasRenderingContext2D;
  private smoothGaugeRpm = 850;
  private smoothGaugeSpeed = 0;

  private readonly gaugeDpr = Math.min(window.devicePixelRatio || 1, 2);
  private readonly speedoLogicalSize = 184;
  private readonly minimapLogicalSize = 164;

  private tourBtn!: HTMLButtonElement;
  private camBtn!: HTMLButtonElement;
  private audioBtn!: HTMLButtonElement;
  private lightsBtn!: HTMLButtonElement;
  private tipsToggleBtn!: HTMLButtonElement;
  private pokemonDialogBox!: HTMLElement;
  private pokemonSpeakerEl!: HTMLElement;
  private pokemonBadgeEl!: HTMLElement;
  private pokemonTextEl!: HTMLElement;
  private pokemonTipsListEl!: HTMLElement;
  private pokemonOpenBtn!: HTMLButtonElement;
  private pokemonNextBtn!: HTMLButtonElement;
  private pokemonCloseBtn!: HTMLButtonElement;
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
        this.announceTourState();
        return;
      }
      if (e.code === 'KeyC') {
        e.preventDefault();
        this.cycleCameraMode();
        return;
      }
      if (e.code === 'KeyV') {
        e.preventDefault();
        this.toggleFirstPersonMode();
        return;
      }
      if (e.code === 'KeyN') {
        if (!this.tipsDismissed) {
          e.preventDefault();
          this.advanceOrSkipPokemonDialog();
        }
        return;
      }
    }

    const num = Number.parseInt(e.key, 10);
    if (num >= 1 && num <= this.projects.length) {
      const target = this.projects.find((p) => p.index === num);
      if (target) {
        this.callbacks.onDriveToProject(target.id);
        this.announceAutopilotTarget(target);
      }
    }
  };

  constructor(root: HTMLElement, projects: PortfolioProject[], callbacks: HudCallbacks) {
    this.root = root;
    this.projects = projects;
    this.callbacks = callbacks;

    this.renderShell();
    this.bindEvents();
    this.syncTipsToggleUi();
    this.showPokemonTip(0);
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
            <span class="station-dot" style="background-color: ${escapeHtml(p.color)}" aria-hidden="true"></span>
            <span>${escapeHtml(p.shortName)}</span>
          </button>
        `
      )
      .join('');

    this.root.innerHTML = `
      <div class="hud-top-stack">
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
            <button type="button" class="ctrl-btn" id="btn-cam-mode" title="Alternar Câmera: 3ª Pessoa → 1ª Pessoa → Órbita (C) | 1ª Pessoa (V)">
              ${ICONS.camera}
              <span>3ª Pessoa</span>
            </button>
            <button type="button" class="ctrl-btn" id="btn-audio" title="Ativar/Desativar Som do Motor">
              ${ICONS.audio}
              <span>Áudio</span>
            </button>
            <button type="button" class="ctrl-btn" id="btn-lights" title="Ligar/Desligar Faróis (H)">
              ${ICONS.lights}
              <span>Farol</span>
            </button>
            <button type="button" class="ctrl-btn" id="btn-reset-car" title="Resetar Posição do Carro (R)">
              ${ICONS.reset}
              <span>Reset</span>
            </button>
            <button type="button" class="ctrl-btn is-active" id="btn-toggle-tips" title="Mostrar/Ocultar balão de dicas">
              ${ICONS.tips}
              <span>Dicas</span>
            </button>
          </div>
        </header>

        <section
          class="pokemon-dialog-box"
          id="pokemon-dialog-box"
          aria-live="polite"
          aria-label="Legenda e dicas de jogo estilo Pokémon"
        >
          <div class="pokemon-dialog-header">
            <div class="pokemon-speaker-pill">
              <span class="pokemon-speaker-dot" id="pokemon-speaker-dot" aria-hidden="true"></span>
              <span class="pokemon-speaker-name" id="pokemon-speaker-name">RODRIGO • GUIA DO GOL G5</span>
            </div>
            <div class="pokemon-header-right">
              <span class="pokemon-dialog-badge" id="pokemon-dialog-badge">DICA 1/5 • COMO JOGAR</span>
              <button type="button" class="pokemon-close-btn" id="btn-pokemon-close" aria-label="Fechar dicas" title="Fechar dicas">${ICONS.close}</button>
            </div>
          </div>

          <div class="pokemon-dialog-body" id="pokemon-dialog-body" title="Clique ou pressione [N] para avançar a fala / próxima dica">
            <p class="pokemon-dialog-text" id="pokemon-dialog-text"></p>
            <span class="pokemon-dialog-cursor" aria-hidden="true">▼</span>
          </div>

          <div class="pokemon-dialog-footer">
            <div class="pokemon-tips-list" id="pokemon-tips-list"></div>
            <div class="pokemon-dialog-actions">
              <button
                type="button"
                class="pokemon-action-btn is-primary is-hidden"
                id="btn-pokemon-open"
                title="Abrir detalhes e simulador interativo desta estação (Tecla E)"
              >
                [E] Abrir Projeto
              </button>
              <button
                type="button"
                class="pokemon-action-btn"
                id="btn-pokemon-next"
                title="Mostrar próxima dica de controles (Tecla N)"
              >
                Próxima Dica [N] ▸
              </button>
            </div>
          </div>
        </section>
      </div>

      <aside class="hud-corner-gauges" aria-label="Velocímetro Forza Horizon e Minimapa Circular">
        <div class="forza-speedo-wrap" title="Velocímetro & Conta-Giros VW Gol G5 1.6">
          <canvas id="hud-forza-speedo" width="184" height="184"></canvas>
        </div>

        <div class="round-minimap-wrap" title="Radar Circular — Clique em uma estação colorida para dirigir até ela">
          <canvas id="hud-minimap" width="164" height="164"></canvas>
        </div>
      </aside>

      <div class="project-modal-backdrop" id="project-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-project-title">
        <div class="project-modal" id="project-modal-container"></div>
      </div>
    `;

    this.minimapCanvas = this.root.querySelector('#hud-minimap') as HTMLCanvasElement;
    this.minimapCanvas.width = Math.round(this.minimapLogicalSize * this.gaugeDpr);
    this.minimapCanvas.height = Math.round(this.minimapLogicalSize * this.gaugeDpr);
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;

    this.speedoCanvas = this.root.querySelector('#hud-forza-speedo') as HTMLCanvasElement;
    this.speedoCanvas.width = Math.round(this.speedoLogicalSize * this.gaugeDpr);
    this.speedoCanvas.height = Math.round(this.speedoLogicalSize * this.gaugeDpr);
    this.speedoCtx = this.speedoCanvas.getContext('2d')!;

    this.tourBtn = this.root.querySelector('#btn-tour') as HTMLButtonElement;
    this.camBtn = this.root.querySelector('#btn-cam-mode') as HTMLButtonElement;
    this.audioBtn = this.root.querySelector('#btn-audio') as HTMLButtonElement;
    this.lightsBtn = this.root.querySelector('#btn-lights') as HTMLButtonElement;
    this.tipsToggleBtn = this.root.querySelector('#btn-toggle-tips') as HTMLButtonElement;
    this.pokemonDialogBox = this.root.querySelector('#pokemon-dialog-box') as HTMLElement;
    this.pokemonSpeakerEl = this.root.querySelector('#pokemon-speaker-name') as HTMLElement;
    this.pokemonBadgeEl = this.root.querySelector('#pokemon-dialog-badge') as HTMLElement;
    this.pokemonTextEl = this.root.querySelector('#pokemon-dialog-text') as HTMLElement;
    this.pokemonTipsListEl = this.root.querySelector('#pokemon-tips-list') as HTMLElement;
    this.pokemonOpenBtn = this.root.querySelector('#btn-pokemon-open') as HTMLButtonElement;
    this.pokemonNextBtn = this.root.querySelector('#btn-pokemon-next') as HTMLButtonElement;
    this.pokemonCloseBtn = this.root.querySelector('#btn-pokemon-close') as HTMLButtonElement;
    this.modalBackdrop = this.root.querySelector('#project-modal-backdrop') as HTMLElement;
    this.modalContainer = this.root.querySelector('#project-modal-container') as HTMLElement;

    this.root.querySelectorAll<HTMLButtonElement>('.station-btn').forEach((btn) => {
      const id = btn.dataset.projectId;
      if (id) {
        this.stationBtns.set(id, btn);
      }
    });

    this.updateCameraModeUi();
  }

  private bindEvents(): void {
    this.stationBtns.forEach((btn, id) => {
      btn.addEventListener('click', () => {
        this.callbacks.onDriveToProject(id);
        const target = this.projects.find((p) => p.id === id);
        if (target) {
          this.announceAutopilotTarget(target);
        }
      });
    });

    this.tourBtn.addEventListener('click', () => {
      this.tourActive = this.callbacks.onToggleTour();
      this.syncTourUi();
      this.announceTourState();
    });

    this.camBtn.addEventListener('click', () => this.cycleCameraMode());

    this.root.querySelector('#pokemon-dialog-body')?.addEventListener('click', () => {
      this.advanceOrSkipPokemonDialog();
    });

    this.pokemonNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nextPokemonTip();
    });

    this.pokemonCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissTips();
    });

    this.tipsToggleBtn.addEventListener('click', () => {
      if (this.tipsDismissed) {
        this.openTips();
      } else {
        this.dismissTips();
      }
    });

    this.pokemonOpenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentProximityProject) {
        this.openProjectModal(this.currentProximityProject);
      }
    });

    const toggleAudioHandler = (): void => {
      this.audioEnabled = this.callbacks.onToggleAudio();
      this.syncAudioUi();
    };

    this.audioBtn.addEventListener('click', toggleAudioHandler);

    this.lightsBtn.addEventListener('click', () => {
      this.headlightsOn = this.callbacks.onToggleHeadlights();
      this.syncHeadlightsUi();
    });

    this.root.querySelector('#btn-reset-car')?.addEventListener('click', () => {
      this.callbacks.onResetCar();
    });

    this.modalBackdrop.addEventListener('click', (ev) => {
      if (ev.target === this.modalBackdrop) {
        this.closeProjectModal();
      }
    });

    this.minimapCanvas.addEventListener('click', (ev) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const clickX =
        rect.width > 0
          ? ((ev.clientX - rect.left) / rect.width) * this.minimapLogicalSize
          : 0;
      const clickY =
        rect.height > 0
          ? ((ev.clientY - rect.top) / rect.height) * this.minimapLogicalSize
          : 0;

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
        this.announceAutopilotTarget(closest);
      }
    });

    window.addEventListener('keydown', this.handleKeyDown);
  }

  private syncTipsToggleUi(): void {
    this.tipsToggleBtn.classList.toggle('is-active', !this.tipsDismissed);
    this.tipsToggleBtn.setAttribute('aria-pressed', String(!this.tipsDismissed));
  }

  private dismissTips(): void {
    this.tipsDismissed = true;
    this.pokemonDialogBox.classList.add('is-dismissed');
    this.pokemonDialogBox.classList.remove('is-typing');
    this.pokemonIsTyping = false;
    if (this.pokemonTypingTimer !== null) {
      window.clearInterval(this.pokemonTypingTimer);
      this.pokemonTypingTimer = null;
    }
    this.syncTipsToggleUi();
  }

  private openTips(): void {
    this.tipsDismissed = false;
    this.pokemonDialogBox.classList.remove('is-dismissed');
    this.syncTipsToggleUi();

    if (this.currentProximityProject) {
      this.pokemonOpenBtn.classList.remove('is-hidden');
      this.lastNarratedStationId = this.currentProximityProject.id;
      this.showStationDialog(this.currentProximityProject, this.currentProximityDist);
    } else {
      this.showPokemonTip(this.pokemonTipIndex);
    }
  }

  private showStationDialog(project: PortfolioProject, dist: number): void {
    const stationDialog = POKEMON_STATION_DIALOGS[project.id];
    this.setPokemonDialog({
      speaker: stationDialog?.speaker ?? `ESTAÇÃO #${project.index} • ${project.shortName.toUpperCase()}`,
      badge: `${project.category.toUpperCase()} • ${dist.toFixed(1)}M`,
      accentColor: project.color,
      caption:
        stationDialog?.caption ??
        `Você chegou em ${project.title}! ${project.subtitle}. Olhe para o telão para assistir à demonstração ao vivo ou pressione [E] para abrir os detalhes!`,
      tips: ['[E] Abrir Simulador', '[Olhar Telão] Roda Vídeo', '[V] Ver do Cockpit', '[N] Ver Dicas'],
    });
  }

  private setPokemonDialog(entry: PokemonDialogEntry): void {
    if (this.tipsDismissed) {
      return;
    }

    if (this.pokemonTypingTimer !== null) {
      window.clearInterval(this.pokemonTypingTimer);
      this.pokemonTypingTimer = null;
    }

    this.pokemonSpeakerEl.textContent = entry.speaker;
    this.pokemonBadgeEl.textContent = entry.badge;

    const dotEl = this.root.querySelector('#pokemon-speaker-dot') as HTMLElement | null;
    if (dotEl) {
      dotEl.style.backgroundColor = entry.accentColor || '#38bdf8';
    }

    this.pokemonTipsListEl.innerHTML = entry.tips
      .map((t) => `<span class="pokemon-tip-pill">${escapeHtml(t)}</span>`)
      .join('');

    this.pokemonCurrentFullText = entry.caption;
    this.pokemonCurrentCharIdx = 0;
    this.pokemonIsTyping = true;
    this.pokemonTextEl.textContent = '';
    this.pokemonDialogBox.classList.add('is-typing');

    this.pokemonTypingTimer = window.setInterval(() => {
      this.pokemonCurrentCharIdx = Math.min(
        this.pokemonCurrentFullText.length,
        this.pokemonCurrentCharIdx + 3,
      );
      this.pokemonTextEl.textContent = this.pokemonCurrentFullText.slice(
        0,
        this.pokemonCurrentCharIdx,
      );
      if (this.pokemonCurrentCharIdx >= this.pokemonCurrentFullText.length) {
        this.finishPokemonTyping();
      }
    }, 22);
  }

  private finishPokemonTyping(): void {
    if (this.pokemonTypingTimer !== null) {
      window.clearInterval(this.pokemonTypingTimer);
      this.pokemonTypingTimer = null;
    }
    this.pokemonIsTyping = false;
    this.pokemonTextEl.textContent = this.pokemonCurrentFullText;
    this.pokemonDialogBox.classList.remove('is-typing');
  }

  private advanceOrSkipPokemonDialog(): void {
    if (this.tipsDismissed) {
      return;
    }
    if (this.pokemonIsTyping) {
      this.finishPokemonTyping();
      return;
    }
    this.nextPokemonTip();
  }

  private showPokemonTip(index: number): void {
    this.pokemonTipIndex =
      ((index % POKEMON_GAMEPLAY_TIPS.length) + POKEMON_GAMEPLAY_TIPS.length) %
      POKEMON_GAMEPLAY_TIPS.length;
    this.pokemonOpenBtn.classList.add('is-hidden');
    this.setPokemonDialog(POKEMON_GAMEPLAY_TIPS[this.pokemonTipIndex]);
  }

  private nextPokemonTip(): void {
    this.lastNarratedStationId = null;
    this.showPokemonTip(this.pokemonTipIndex + 1);
  }

  private announceAutopilotTarget(project: PortfolioProject): void {
    if (this.tipsDismissed) {
      return;
    }
    this.pokemonOpenBtn.classList.add('is-hidden');
    this.setPokemonDialog({
      speaker: `PILOTO AUTOMÁTICO • ROTA #${project.index}`,
      badge: `INDO ATÉ ${project.shortName.toUpperCase()}`,
      accentColor: project.color,
      caption: `Levando o Gol G5 automaticamente pelo corredor central até a Estação #${project.index} (${project.title}). Pressione qualquer tecla [WASD] se quiser assumir o volante!`,
      tips: ['[WASD] Assumir Volante', '[V] Ver em 1ª Pessoa', '[E] Abrir ao Chegar', '[N] Dicas'],
    });
  }

  private announceTourState(): void {
    if (this.tipsDismissed) {
      return;
    }
    if (this.tourActive) {
      this.setPokemonDialog({
        speaker: 'TOUR AUTOMÁTICO ATIVADO',
        badge: 'ROTA COMPLETA • 7 ESTAÇÕES',
        accentColor: '#2ea86f',
        caption:
          'O Gol G5 agora vai visitar todas as 7 estações do portfólio em sequência, parando em cada baia para você assistir aos vídeos! Aperte [V] para curtir o passeio de dentro do cockpit!',
        tips: ['[V] Cockpit 1ª Pessoa', '[E] Abrir Projeto', '[T / WASD] Parar Tour', '[N] Dicas'],
      });
    } else {
      this.showPokemonTip(this.pokemonTipIndex);
    }
  }

  private cycleCameraMode(): void {
    const nextMode: CameraMode =
      this.cameraMode === 'chase'
        ? 'firstperson'
        : this.cameraMode === 'firstperson'
          ? 'orbit'
          : 'chase';
    this.setCameraMode(nextMode);
  }

  private toggleFirstPersonMode(): void {
    const nextMode: CameraMode =
      this.cameraMode === 'firstperson' ? 'chase' : 'firstperson';
    this.setCameraMode(nextMode);
  }

  private setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    this.updateCameraModeUi();
    this.callbacks.onToggleCameraMode(mode);

    if (this.tipsDismissed) {
      return;
    }

    if (mode === 'firstperson') {
      this.setPokemonDialog({
        speaker: 'COCKPIT VW GOL G5 • 1ª PESSOA',
        badge: 'VISÃO DO MOTORISTA ATIVA',
        accentColor: '#38bdf8',
        caption:
          'Você está dentro do Gol G5! Use [A] e [D] para girar o volante para a esquerda e direita, [W/S] para acelerar, arraste o mouse para olhar o painel e aperte [V] ou [C] para mudar a câmera.',
        tips: ['[A / D] Virar Volante', '[W / S] Acelerar', '[Mouse] Olhar Painel', '[V] Sair 1ª Pessoa'],
      });
    } else if (mode === 'orbit') {
      this.setPokemonDialog({
        speaker: 'CÂMERA ÓRBITA 360°',
        badge: 'INSPEÇÃO DO GOL G5 & MUNDO',
        accentColor: '#c4a435',
        caption:
          'Modo Órbita ativado! Arraste com o botão esquerdo do mouse para girar 360° ao redor do Gol G5 Preto e use o scroll para dar zoom. Pressione [C] para voltar à câmera de direção.',
        tips: ['[Mouse] Girar 360°', '[Scroll] Zoom', '[C] Voltar 3ª Pessoa', '[WASD] Dirigir'],
      });
    } else {
      this.setPokemonDialog({
        speaker: 'CÂMERA 3ª PESSOA (CHASE)',
        badge: 'DIREÇÃO & ENQUADRAMENTO',
        accentColor: '#2ea86f',
        caption:
          'Câmera de perseguição em 3ª pessoa ativa! Ao estacionar perto de um telão, a câmera enquadra automaticamente o Gol G5 ao lado do projeto.',
        tips: ['[WASD] Dirigir', '[V] Ir para 1ª Pessoa', '[Espaço] Drift', '[E] Abrir Projeto'],
      });
    }
  }

  private updateCameraModeUi(): void {
    this.camBtn.classList.toggle('is-active', this.cameraMode !== 'chase');
    const labelSpan = this.camBtn.querySelector('span');
    if (labelSpan) {
      labelSpan.textContent =
        this.cameraMode === 'chase'
          ? '3ª Pessoa'
          : this.cameraMode === 'firstperson'
            ? '1ª Pessoa'
            : 'Órbita';
    }
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
  }

  private syncHeadlightsUi(): void {
    this.lightsBtn.classList.toggle('is-active', this.headlightsOn);
  }

  public updateTelemetry(t: CarTelemetryState): void {
    const isTour = t.autopilotMode === 'tour';
    if (isTour !== this.tourActive) {
      this.tourActive = isTour;
      this.syncTourUi();
    }

    if (t.headlightsOn !== this.headlightsOn) {
      this.headlightsOn = t.headlightsOn;
      this.syncHeadlightsUi();
    }

    this.stationBtns.forEach((btn, id) => {
      btn.classList.toggle('is-near', t.nearestProjectId === id);
      btn.classList.toggle('is-target', t.autopilotTargetId === id && t.autopilotMode !== 'manual');
    });

    this.renderForzaSpeedometer(t);
    this.renderMinimap(t);
  }

  public setProximity(project: PortfolioProject | null, dist: number): void {
    this.currentProximityProject = project;
    this.currentProximityDist = dist;
    if (!project) {
      this.pokemonOpenBtn.classList.add('is-hidden');
      if (this.lastNarratedStationId !== null) {
        this.lastNarratedStationId = null;
      }
      return;
    }

    this.pokemonOpenBtn.classList.remove('is-hidden');

    if (this.tipsDismissed) {
      return;
    }

    if (this.lastNarratedStationId !== project.id) {
      this.lastNarratedStationId = project.id;
      this.showStationDialog(project, dist);
    }
  }

  /**
   * Renders a Forza Horizon-inspired analog needle tachometer & digital speedometer
   * in the bottom-right corner alongside the circular minimap.
   */
  private renderForzaSpeedometer(t: CarTelemetryState): void {
    const ctx = this.speedoCtx;
    const w = this.speedoLogicalSize;
    const h = this.speedoLogicalSize;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const outerR = Math.min(w, h) * 0.5 - 6;

    const targetRpm = Math.max(0, Math.min(8000, t.rpm));
    const targetSpeed = Math.max(0, Math.abs(t.speedKmh));
    this.smoothGaugeRpm += (targetRpm - this.smoothGaugeRpm) * 0.28;
    this.smoothGaugeSpeed += (targetSpeed - this.smoothGaugeSpeed) * 0.35;

    ctx.save();
    ctx.setTransform(this.gaugeDpr, 0, 0, this.gaugeDpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 1. Dark translucent circular dial backing with crisp metallic bezel
    const bgGrad = ctx.createRadialGradient(cx, cy, 12, cx, cy, outerR);
    bgGrad.addColorStop(0.0, 'rgba(13, 18, 28, 0.86)');
    bgGrad.addColorStop(0.75, 'rgba(10, 14, 22, 0.90)');
    bgGrad.addColorStop(1.0, 'rgba(6, 9, 15, 0.95)');

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
    ctx.stroke();

    // Gauge sweep angles: 135 deg (bottom-left) to 405 deg (bottom-right) = 270 deg sweep
    const startAngle = (135 * Math.PI) / 180;
    const sweepAngle = (270 * Math.PI) / 180;
    const endAngle = startAngle + sweepAngle;
    const maxRpm = 8000;
    const redlineRpm = 6500;
    const redlineStartAngle = startAngle + (redlineRpm / maxRpm) * sweepAngle;

    const arcR = outerR - 11;

    // 2. Background RPM track arc
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, startAngle, redlineStartAngle);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'butt';
    ctx.stroke();

    // Redline track segment (6.5k .. 8k RPM)
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, redlineStartAngle, endAngle);
    ctx.strokeStyle = 'rgba(220, 76, 76, 0.38)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // 3. Active glowing RPM progress arc (follows needle like Forza Horizon)
    const rpmNorm = Math.max(0, Math.min(1, this.smoothGaugeRpm / maxRpm));
    const needleAngle = startAngle + rpmNorm * sweepAngle;
    const isRedline = this.smoothGaugeRpm >= redlineRpm - 150;

    ctx.beginPath();
    ctx.arc(cx, cy, arcR, startAngle, Math.max(startAngle + 0.03, needleAngle));
    ctx.strokeStyle = isRedline ? '#ef4444' : '#38bdf8';
    ctx.lineWidth = 6;
    ctx.stroke();

    // 4. Major (0..8) & Minor tick marks + numbers
    ctx.font = '700 10.5px "Space Grotesk", "IBM Plex Mono", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const totalTicks = 32; // 4 subdivisions per 1000 RPM
    for (let i = 0; i <= totalTicks; i++) {
      const frac = i / totalTicks;
      const ang = startAngle + frac * sweepAngle;
      const isMajor = i % 4 === 0;
      const isHalf = i % 2 === 0 && !isMajor;
      const inRed = frac >= redlineRpm / maxRpm;

      const tickOuter = arcR - 5;
      const tickInner = isMajor ? tickOuter - 9 : isHalf ? tickOuter - 6 : tickOuter - 3.5;

      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      ctx.beginPath();
      ctx.moveTo(cx + cosA * tickOuter, cy + sinA * tickOuter);
      ctx.lineTo(cx + cosA * tickInner, cy + sinA * tickInner);
      ctx.strokeStyle = inRed
        ? isMajor
          ? '#f87171'
          : 'rgba(248, 113, 113, 0.55)'
        : isMajor
          ? 'rgba(241, 245, 249, 0.92)'
          : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();

      if (isMajor) {
        const rpmDigit = i / 4;
        const labelR = tickInner - 10;
        ctx.fillStyle = inRed ? '#f87171' : 'rgba(226, 232, 240, 0.88)';
        ctx.fillText(String(rpmDigit), cx + cosA * labelR, cy + sinA * labelR);
      }
    }

    // "x1000 RPM" micro caption near top
    ctx.font = '600 8px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.68)';
    ctx.fillText('×1000 RPM', cx, cy - 26);

    // 5. Analog Needle (sweeping pointer with counterweight & glowing tip)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);

    ctx.shadowColor = isRedline ? 'rgba(239, 68, 68, 0.75)' : 'rgba(56, 189, 248, 0.65)';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(-12, -2.2);
    ctx.lineTo(arcR - 7, -1.1);
    ctx.lineTo(arcR - 2, 0);
    ctx.lineTo(arcR - 7, 1.1);
    ctx.lineTo(-12, 2.2);
    ctx.closePath();
    ctx.fillStyle = isRedline ? '#ff4d4d' : '#f8fafc';
    ctx.fill();
    ctx.restore();

    // Center cap / gear ring
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = isRedline ? '#ef4444' : 'rgba(56, 189, 248, 0.65)';
    ctx.stroke();

    // Gear indicator inside center hub
    ctx.font = '700 15px "IBM Plex Mono", monospace';
    ctx.fillStyle = isRedline ? '#f87171' : '#38bdf8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.gear, cx, cy + 0.5);

    // 6. Digital Speed Readout (bottom window of Forza dial)
    const speedInt = Math.round(Math.abs(t.speedKmh));
    ctx.font = '700 27px "Space Grotesk", "IBM Plex Mono", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(speedInt), cx, cy + 44);

    ctx.font = '600 9.5px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.fillText('KM/H', cx, cy + 61);

    // Subtle status indicator pill at bottom-center of dial (Auto / Turbo / Drift)
    let modeTag = '';
    let modeColor = '#38bdf8';
    if (t.autopilotMode !== 'manual') {
      modeTag = t.autopilotMode === 'tour' ? 'TOUR AUTO' : 'AUTO';
      modeColor = '#2ea86f';
    } else if (t.isTurbo) {
      modeTag = 'TURBO';
      modeColor = '#38bdf8';
    } else if (t.isDrifting) {
      modeTag = 'DRIFT';
      modeColor = '#c4528d';
    }

    if (modeTag) {
      ctx.font = '700 8.5px "IBM Plex Mono", monospace';
      ctx.fillStyle = modeColor;
      ctx.fillText(modeTag, cx, cy - 39);
    }
    ctx.restore();
  }

  private worldToMinimap(wx: number, wz: number): { x: number; y: number } {
    const w = this.minimapLogicalSize;
    const h = this.minimapLogicalSize;
    const padX = 24;
    const padY = 18;
    const nx = (wx + 28) / 56; // X in [-28, 28]
    const ny = (22 - wz) / 254; // Z in [-232, 22]: bottom (+22) -> top (-232)
    return {
      x: Math.max(padX, Math.min(w - padX, padX + nx * (w - padX * 2))),
      y: Math.max(padY, Math.min(h - padY, h - padY - ny * (h - padY * 2))),
    };
  }

  private renderMinimap(t: CarTelemetryState): void {
    const ctx = this.minimapCtx;
    const w = this.minimapLogicalSize;
    const h = this.minimapLogicalSize;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.5 - 5;

    ctx.save();
    ctx.setTransform(this.gaugeDpr, 0, 0, this.gaugeDpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 15, 24, 0.88)';
    ctx.fill();
    ctx.clip();

    // Subtle radar rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (const ringR of [r * 0.35, r * 0.7]) {
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Discreet stone-gray bay connectors from X=0 to each station
    ctx.strokeStyle = 'rgba(148, 158, 170, 0.36)';
    ctx.lineWidth = 3;
    for (const project of this.projects) {
      if (Math.abs(project.worldPos.x) > 0.5) {
        const spinePt = this.worldToMinimap(0, project.worldPos.z);
        const bayPt = this.worldToMinimap(project.worldPos.x, project.worldPos.z);
        ctx.beginPath();
        ctx.moveTo(spinePt.x, spinePt.y);
        ctx.lineTo(bayPt.x, bayPt.y);
        ctx.stroke();
      }
    }

    // Central stone-gray avenue along X = 0
    const startPt = this.worldToMinimap(0, 18);
    const endPt = this.worldToMinimap(0, -214);
    ctx.strokeStyle = 'rgba(148, 158, 170, 0.46)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startPt.x, startPt.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();

    // Subtle center road line
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startPt.x, startPt.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();

    // 7 uniquely colored station markers + index labels
    ctx.font = '700 9.5px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    for (const project of this.projects) {
      const pt = this.worldToMinimap(project.worldPos.x, project.worldPos.z);
      const isFocused =
        t.nearestProjectId === project.id ||
        (t.autopilotMode !== 'manual' && t.autopilotTargetId === project.id);
      const radius = isFocused ? 5.4 : 4.3;

      if (isFocused) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius + 2.4, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = project.color;
      ctx.fill();
      ctx.strokeStyle = isFocused ? '#ffffff' : 'rgba(15, 23, 42, 0.88)';
      ctx.lineWidth = isFocused ? 1.2 : 1;
      ctx.stroke();

      // Readable 1..7 index beside marker
      const isLeft = project.worldPos.x < 0;
      ctx.textAlign = isLeft ? 'right' : 'left';
      const labelX = isLeft ? pt.x - (radius + 3.5) : pt.x + (radius + 3.5);
      ctx.fillStyle = isFocused ? '#ffffff' : 'rgba(226, 232, 240, 0.85)';
      ctx.fillText(String(project.index), labelX, pt.y + 0.5);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Gol G5 in crisp white with clear directional arrow
    const carPt = this.worldToMinimap(t.posX, t.posZ);
    const rad = ((t.headingDeg - 90) * Math.PI) / 180;
    ctx.save();
    ctx.translate(carPt.x, carPt.y);
    ctx.rotate(rad);
    ctx.beginPath();
    ctx.moveTo(7.5, 0);
    ctx.lineTo(-4.8, -4.2);
    ctx.lineTo(-2.3, 0);
    ctx.lineTo(-4.8, 4.2);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Outer circular radar bezel + North indicator
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.26)';
    ctx.stroke();

    ctx.font = '700 8.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
    ctx.fillText('N', cx, 11);
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

    // Header bar (#1A2128 with Vincula cobalt blue accent)
    ctx.fillStyle = '#1a2128';
    ctx.fillRect(0, 0, w, 46);
    ctx.fillStyle = '#4d79e8';
    ctx.fillRect(0, 44, w, 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 14px "Space Grotesk", sans-serif';
    ctx.fillText('Vincula • Análise de Vínculos (/casos/409/vinculos)', 18, 28);

    const nodes = [
      { x: w * 0.5, y: h * 0.52, r: 28, color: '#dc4c4c', label: 'Investigado Principal', sub: 'CPF •••.412.880-••' },
      { x: w * 0.25, y: h * 0.34, r: 21, color: '#c4a435', label: 'Banco do Brasil', sub: 'Ag 4546 • SIMBA' },
      { x: w * 0.76, y: h * 0.36, r: 21, color: '#2ea86f', label: 'Empresa Parceira', sub: 'CNPJ 14.882.•••' },
      { x: w * 0.28, y: h * 0.75, r: 19, color: '#4d79e8', label: 'SITTEL_ERB.csv', sub: '248 chamadas' },
      { x: w * 0.73, y: h * 0.75, r: 19, color: '#279b9e', label: 'RIF_COAF_09.xlsx', sub: '14 alertas' },
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
      ctx.fillStyle = '#4d79e8';
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
      { tier: 'A1', color: '#dc4c4c', name: 'Paciente #412 • Colecistectomia', note: 'Achado literal: "internação prévia em UPA 48h"', score: 94 },
      { tier: 'A2', color: '#c4528d', name: 'Paciente #903 • Artroplastia Quadril', note: 'Achado literal: "3 atendimentos em UPA"', score: 86 },
      { tier: 'B', color: '#c4a435', name: 'Paciente #218 • Hernioplastia', note: 'Achado literal: "retorno ao Pronto-Socorro"', score: 67 },
      { tier: 'C', color: '#4a93d4', name: 'Paciente #789 • Eletivo Regular', note: 'Sem sinais agudos no prontuário', score: 34 },
    ];

    const activeIdx = Math.floor(t / 2.2) % rows.length;
    rows.forEach((row, idx) => {
      const y = 84 + idx * 88;
      const isFocused = idx === activeIdx;

      ctx.fillStyle = isFocused ? '#23262e' : '#1c1f26';
      ctx.fillRect(22, y, w - 44, 72);
      ctx.strokeStyle = isFocused ? '#e2e8f0' : 'rgba(255,255,255,0.08)';
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
      ctx.fillStyle = '#e2e8f0';
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
    if (this.pokemonTypingTimer !== null) {
      window.clearInterval(this.pokemonTypingTimer);
      this.pokemonTypingTimer = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
