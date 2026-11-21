export type DemoKind =
  | 'leitorECU'
  | 'vstable'
  | 'chatbot'
  | 'vincula'
  | 'ordovitae'
  | 't2ia'
  | 'smarttalent';

export interface ProjectMetric {
  label: string;
  value: string;
}

export interface PortfolioProject {
  id: string;
  index: number;
  shortName: string;
  title: string;
  subtitle: string;
  category: string;
  period: string;
  color: string;
  repoUrl: string;
  repoLabel: string;
  summary: string;
  whatItDoes: string;
  architecture: string;
  technologies: string[];
  metrics: ProjectMetric[];
  worldPos: {
    x: number;
    z: number;
    angleY: number;
  };
  demoKind: DemoKind;
  screenshots: string[];
  isChatbot?: boolean;
}

export const PORTFOLIO_PROJECTS: PortfolioProject[] = [
  {
    id: 'leitorECU',
    index: 1,
    shortName: 'leitorECU',
    title: 'leitorECU',
    subtitle: 'Datalogger & Scanner Automotivo 30 FPS — VW Gol G5 (Bosch ME7.5.30)',
    category: 'Sistemas Embarcados & Telemetria',
    period: '2026',
    color: '#dc4c4c',
    repoUrl: 'https://github.com/RodrigoSchmittDeAlmeida/leitorECU',
    repoLabel: 'github.com/RodrigoSchmittDeAlmeida/leitorECU',
    summary:
      'Scanner e datalogger de telemetria automotiva em 30 FPS com comunicação nativa via VAG KWP2000 (ATSP4, 5-baud 0x01), KW1281 e Ford HS-CAN 500 kbps UDS.',
    whatItDoes:
      'Conecta-se à central Bosch ME7.5.30 do Volkswagen Gol G5 (ECU 032906032AJ) por cabo USB KKL 409.1 ou adaptador Bluetooth Low Energy (BLE) para extrair blocos de medição reais (Blocos 003, 032, 033 e 103). No veículo real, diagnosticou a falha do Bloco 103.5 travado em 99,608% de adaptação de etanol com LTFT em -18,75%, validando a normalização para 68,4% após reset do Canal 00.',
    architecture:
      'Desenvolvido com princípios SOLID desacoplando transporte, estratégia veicular, detecção de corte em desaceleração (DFCO) e persistência via ITransport, IVehicleStrategy, IDetector e IDataLogger. A UI desktop em PyQt6 + PyQtGraph renderiza 14 cards e osciloscópio a 30 FPS sem bloquear a leitura serial/BLE.',
    technologies: [
      'Python 3.13',
      'PyQt6',
      'PyQtGraph 30 FPS',
      'KWP2000 / KW1281',
      'Ford HS-CAN UDS',
      'PySerial & Bleak BLE',
      'NumPy',
      'Pytest (99 testes)',
    ],
    metrics: [
      { label: 'ECU Real', value: '032906032AJ (ME7.5.30)' },
      { label: 'Blocos KWP2000', value: '032 / 033 / 103' },
      { label: 'Taxa de Plotagem', value: '30 FPS • 14 cards' },
      { label: 'Suíte Pytest', value: '99/99 testes' },
    ],
    worldPos: { x: -16.5, z: -28, angleY: 0.42 },
    demoKind: 'leitorECU',
    screenshots: [
      './screens/leitorecu/01-telemetry.png',
      './screens/leitorecu/02-map2d.png',
      './screens/leitorecu/03-modules.png',
      './screens/leitorecu/04-fordka.png',
    ],
  },
  {
    id: 'vstable',
    index: 2,
    shortName: 'V-Stable',
    title: 'V-Stable',
    subtitle: 'Plataforma B2B de Câmbio Internacional, Stablecoins & AppSec em Rust',
    category: 'FinTech B2B & AppSec',
    period: 'AGES / PUCRS • 2026',
    color: '#2ea86f',
    repoUrl: 'https://github.com/RodrigoSchmittDeAlmeida/v-stable-frontend',
    repoLabel: 'github.com/RodrigoSchmittDeAlmeida/v-stable-frontend',
    summary:
      'Infraestrutura corporativa de liquidação cross-border em stablecoins (USDC, USDT, BRLA, EURC) com trilhos PIX, ACH, Wire, SEPA e SWIFT, sanitizador em Rust e pentest STRIDE.',
    whatItDoes:
      'Orquestra operações B2B de câmbio e remessas internacionais para PMEs brasileiras com busca automática pela melhor cotação, trava de preço, autenticação 2FA TOTP (RFC 6238 protegida por AES-256-GCM) e emissão de comprovante em PDF. Uploads de KYC passam pela crate Rust vstable-media-sanitizer antes de chegar ao storage.',
    architecture:
      'Backend Java 25 com Spring Boot 4.1.1 e PostgreSQL 16 (Flyway V1–V20) integrado ao frontend React 19 + TypeScript + Tailwind CSS. A crate Rust zero-unsafe bloqueia payloads maliciosos em PDFs e image bombs, complementada por SpotBugs/FindSecBugs, 37/37 testes automatizados de pentest STRIDE e Terraform AWS.',
    technologies: [
      'Java 25 & Spring Boot 4.1.1',
      'React 19 & TypeScript',
      'PostgreSQL 16 (Flyway V1–V20)',
      'Rust (vstable-media-sanitizer)',
      'SpotBugs / FindSecBugs',
      'Pentest STRIDE (37/37)',
      'Terraform AWS',
      '2FA TOTP (RFC 6238)',
    ],
    metrics: [
      { label: 'Pentest STRIDE', value: '37/37 aprovados' },
      { label: 'Schema SQL', value: 'Flyway V1–V20' },
      { label: 'Sanitizador Rust', value: 'zero-unsafe • 28 testes' },
      { label: 'Trilhos Globais', value: 'PIX • ACH • SEPA • SWIFT' },
    ],
    worldPos: { x: 16.5, z: -58, angleY: -0.42 },
    demoKind: 'vstable',
    screenshots: [
      './screens/vstable/01-login.png',
      './screens/vstable/02-transfer-dados.png',
      './screens/vstable/03-transfer-revisao.png',
      './screens/vstable/04-transfer-2fa.png',
      './screens/vstable/05-historico.png',
      './screens/vstable/06-detalhes.png',
      './screens/vstable/07-beneficiario.png',
    ],
  },
  {
    id: 'chatbot',
    index: 3,
    shortName: 'Chatbot IA',
    title: 'V-Stable Chatbot IA',
    subtitle: 'Assistente Virtual de Suporte Zero-PII & Rate-Limit de Nielsen',
    category: 'IA Aplicada & Engenharia de UX',
    period: 'AGES / PUCRS • 2026',
    color: '#279b9e',
    repoUrl: 'https://github.com/RodrigoSchmittDeAlmeida/v-stable-frontend',
    repoLabel: 'SupportChatWidget.tsx • v-stable-frontend',
    summary:
      'Assistente conversacional integrado à V-Stable (SupportChatWidget.tsx + SupportChatService.java) com fallback offline Zero-PII, heurísticas de Nielsen e controle de taxa de 15 req/min.',
    whatItDoes:
      'Responde em português sobre corredores cambiais (como a restrição bancária de COP na Colômbia e alternativas via Wallet Cripto/USD), gestão de membros e perfis da empresa, países e moedas suportadas (ACH, Wire, SEPA, SPEI, CVU, SWIFT 16+) e troca segura de 2FA TOTP sem expor dados sensíveis ao provedor externo.',
    architecture:
      'Componente React 19 (SupportChatWidget.tsx) com histórico limitado às 6 últimas mensagens, AbortController contra race conditions e janela deslizante no cliente e no Spring Boot (15 req/min). Quando o limite é atingido, exibe timer regressivo tabular (heurística #1 de Nielsen) e alterna para base determinística local quando a API externa está offline.',
    technologies: [
      'React 19 & TypeScript',
      'Spring Boot SupportChatService',
      'Gemini / DeepSeek + Fallback Local',
      'Política Zero-PII',
      'Rate-Limit 15 req/min',
      'Heurísticas de Nielsen',
    ],
    metrics: [
      { label: 'Rate-Limit', value: '15 req/min + cooldown' },
      { label: 'Privacidade', value: 'Zero-PII ao provedor IA' },
      { label: 'Resiliência', value: 'Fallback offline embutido' },
      { label: 'Perguntas Rápidas', value: '4 fluxos principais' },
    ],
    worldPos: { x: -16.5, z: -88, angleY: 0.42 },
    demoKind: 'chatbot',
    screenshots: [],
    isChatbot: true,
  },
  {
    id: 'vincula',
    index: 4,
    shortName: 'Vincula',
    title: 'Vincula',
    subtitle: 'Plataforma Investigativa de Análise de Vínculos em Grafo Interativo',
    category: 'Investigação Digital & Grafos',
    period: 'AGES / PUCRS • 2026',
    color: '#4d79e8',
    repoUrl: 'https://tools.ages.pucrs.br/vincula/frontend',
    repoLabel: 'tools.ages.pucrs.br/vincula/frontend',
    summary:
      'Aplicação investigativa desenvolvida na AGES/PUCRS em Next.js 15.4 + React 19.1 com grafo Neo4j NVL para cruzar quebras de sigilo SIMBA, SITTEL, RIF e extratos bancários.',
    whatItDoes:
      'Permite a analistas e investigadores importar arquivos heterogêneos (SIMBA, SITTEL, RIF e planilhas/extratos CNAB, CSV e XLSX) dentro de um caso e explorar relacionamentos financeiros e telefônicos em um grafo interativo com filtros por CPF/CNPJ, origem de dados e inspeção detalhada de nós e arestas.',
    architecture:
      'Frontend em Next.js 15.4.6, React 19.1.0, Material UI 7.3 e TanStack Query 5 com visualização em grafo baseada em @neo4j-nvl/react e @neo4j-nvl/base. Diferencia semanticamente investigados, entidades relacionadas e arquivos-fonte por cor, pondera espessura das arestas pelo log da quantidade de interações e exporta dossiês em jsPDF.',
    technologies: [
      'Next.js 15.4',
      'React 19.1',
      '@neo4j-nvl/react',
      'Material UI 7.3',
      'TanStack Query',
      'SIMBA / SITTEL / RIF',
      'CNAB / CSV / XLSX',
      'jsPDF & Vitest',
    ],
    metrics: [
      { label: 'Stack Web', value: 'Next.js 15.4 + React 19.1' },
      { label: 'Motor de Grafo', value: '@neo4j-nvl/react' },
      { label: 'Fontes Integradas', value: 'SIMBA • SITTEL • RIF' },
      { label: 'Ingestão', value: 'CNAB • CSV • XLSX' },
    ],
    worldPos: { x: 16.5, z: -118, angleY: -0.42 },
    demoKind: 'vincula',
    screenshots: [],
  },
  {
    id: 'ordovitae',
    index: 5,
    shortName: 'OrdoVitae',
    title: 'OrdoVitae',
    subtitle: 'Priorização Cirúrgica no SUS com IA Híbrida Anti-Alucinação',
    category: 'HealthTech & IA Clínica',
    period: '9ª Hackatona PUCRS / HSL • 2026',
    color: '#c4528d',
    repoUrl: 'https://github.com/Hacktona-AGES-2026/OrdoVitae',
    repoLabel: 'github.com/Hacktona-AGES-2026/OrdoVitae',
    summary:
      'Motor híbrido desenvolvido na 9ª Hackatona PUCRS / Hospital São Lucas unindo regras clínicas SWALIS e DeepSeek-V3 para reordenar filas cirúrgicas do SUS com 0% de alucinação.',
    whatItDoes:
      'Lê evoluções clínicas em texto livre de pacientes na fila cirúrgica para localizar sinais ocultos de agravamento — como internações prévias em UPA e retornos ao Pronto-Socorro. Cada achado sugerido pelo LLM só entra no cálculo de prioridade após validação literal contra o prontuário original, garantindo explicabilidade médica.',
    architecture:
      'Backend FastAPI + SQLAlchemy + SQLite com execução paralela e deduplicação semântica que reduziu chamadas ao DeepSeek-V3 em 63% (988 chamadas por $0.0699 sobre 941 pacientes e 1.490 eventos). Frontend em React 19 + Recharts com faixas de risco SWALIS (A1–D), timeline diária e decisão clínica auditável.',
    technologies: [
      'Python & FastAPI',
      'SQLite & SQLAlchemy',
      'DeepSeek-V3',
      'Regras Clínicas SWALIS',
      'React 19 & TypeScript',
      'Recharts & Tailwind v4',
      'Validação Literal (0% aluc.)',
    ],
    metrics: [
      { label: 'Base Processada', value: '941 pacientes • 1.490 eventos' },
      { label: 'Custo DeepSeek-V3', value: '988 chamadas (-63%) • $0.0699' },
      { label: 'Alucinação', value: '0% (validação literal)' },
      { label: 'Testes Automatizados', value: '22/22 aprovados' },
    ],
    worldPos: { x: -16.5, z: -148, angleY: 0.42 },
    demoKind: 'ordovitae',
    screenshots: [],
  },
  {
    id: 't2ia',
    index: 6,
    shortName: 'T2IA — Rede Neural & AG',
    title: 'T2IA — Rede Neural & AG',
    subtitle: 'MLP Treinada por Algoritmo Genético (BLX-α) vs Minimax no Jogo da Velha',
    category: 'Inteligência Artificial & Computação Evolutiva',
    period: 'PUCRS • IA • 2026',
    color: '#c4a435',
    repoUrl: 'https://github.com/RodrigoSchmittDeAlmeida/T2IA',
    repoLabel: 'github.com/RodrigoSchmittDeAlmeida/T2IA',
    summary:
      'Implementação em Python puro (src/app.py) de uma Rede Neural MLP evoluída sem backpropagation via Algoritmo Genético (BLX-α, elitismo e currículo Médio→Difícil) contra o Minimax.',
    whatItDoes:
      'Treina uma rede neural 9-18-9 (351 pesos com ativação tanh) para jogar Jogo da Velha diretamente contra o algoritmo Minimax em três modos de currículo (Médio → Difícil). Na interface desktop Tkinter, o usuário acompanha a curva de fitness geração a geração, desafia o Minimax ou joga contra a rede treinada vendo o mapa de calor 3×3 das 9 saídas.',
    architecture:
      'Núcleo matemático em Python puro sem frameworks de deep learning: MLP em src/neural_net.py e motor evolutivo em src/genetic_algo.py com seleção por torneio, cruzamento real BLX-α (alpha=0.5), mutação gaussiana, elitismo e detecção de estagnação. A UI Tkinter (tema clam) exibe tabuleiro interativo, gráfico evolutivo e matriz de ativações tanh.',
    technologies: [
      'Python Puro (MLP 9-18-9)',
      'Algoritmo Genético (BLX-α)',
      'Elitismo & Torneio',
      'Currículo Médio → Difícil',
      'Minimax Adversarial',
      'Tkinter (src/app.py)',
      'Mapa de Calor tanh 3×3',
    ],
    metrics: [
      { label: 'Topologia MLP', value: '9 → 18 → 9 (351 pesos)' },
      { label: 'Operadores AG', value: 'BLX-α (0.5) + Elitismo' },
      { label: 'Currículo', value: 'Médio → Difícil vs Minimax' },
      { label: 'Visualização', value: 'Fitness + Heatmap tanh 3×3' },
    ],
    worldPos: { x: 16.5, z: -178, angleY: -0.42 },
    demoKind: 't2ia',
    screenshots: [],
  },
  {
    id: 'smarttalent',
    index: 7,
    shortName: 'Smart Talent',
    title: 'Smart Talent',
    subtitle: 'Torre de Decisão Logística & Predição de Atrasos (DataCo Supply Chain)',
    category: 'Ciência de Dados & Machine Learning',
    period: 'PUCRS • 2026',
    color: '#4a93d4',
    repoUrl: 'https://github.com/RodrigoSchmittDeAlmeida/Grupo8-Smart-Talent',
    repoLabel: 'github.com/RodrigoSchmittDeAlmeida/Grupo8-Smart-Talent',
    summary:
      'Pipeline analítico e preditivo sobre 180.519 pedidos do dataset DataCo Supply Chain utilizando Random Forest (83,22% de precisão na classe 1) exposto via FastAPI, Docker e dashboard web.',
    whatItDoes:
      'Processa o histórico logístico da cadeia DataCo para mapear risco de atraso por região, paradoxo de Simpson entre segmentos, dias reais vs agendados e prejuízo acumulado por categoria. Disponibiliza predição individual de risco de atraso (Late_delivery_risk) via endpoint REST /predict integrado ao painel web.',
    architecture:
      'Pipeline em Python/Pandas com split cronológico agrupado por Order Id (157.741 linhas de treino e 22.778 de teste) para evitar vazamento temporal, modelo Random Forest serializado em joblib e servido por API FastAPI em container Docker junto ao dashboard interativo e gráficos exportados.',
    technologies: [
      'Python & Pandas',
      'Scikit-Learn (Random Forest)',
      'FastAPI (/health, /predict)',
      'Docker',
      'DataCo (180.519 linhas)',
      'Dashboard Web HTML/JS',
    ],
    metrics: [
      { label: 'Dataset DataCo', value: '180.519 registros' },
      { label: 'Precisão Classe 1', value: '83,22% (Random Forest)' },
      { label: 'Acurácia / Recall', value: '69,25% acc • 55,01% rec' },
      { label: 'Serving', value: 'FastAPI + Docker' },
    ],
    worldPos: { x: 0, z: -214, angleY: 0.0 },
    demoKind: 'smarttalent',
    screenshots: [
      './screens/smarttalent/00-dashboard.png',
      './screens/smarttalent/01-risco-regiao.png',
      './screens/smarttalent/02-atraso-status.png',
      './screens/smarttalent/03-prejuizo-categoria.png',
      './screens/smarttalent/04-envio-real-agendado.png',
      './screens/smarttalent/05-paradoxo-simpson.png',
      './screens/smarttalent/06-prejuizo-acumulado.png',
    ],
  },
];
