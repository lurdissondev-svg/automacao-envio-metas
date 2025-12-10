// Tipos para configuração
export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

// Tipos para UAZAPI
export interface UazapiConfig {
  baseUrl: string;
  token: string;
  instanceId: string;  // ID da instância WhatsApp
  adminToken?: string;
}

export interface UazapiConnectionStatus {
  instance?: {
    status: 'connected' | 'disconnected' | 'connecting';
    qrcode?: string;
  };
  status?: {
    connected: boolean;
    loggedIn: boolean;
  };
}

export interface UazapiConnectResponse {
  status?: string;
  connected?: boolean;
  loggedIn?: boolean;
  qrcode?: string;  // base64 data URI: "data:image/png;base64,..."
  paircode?: string;
}

export interface UazapiSendMediaPayload {
  number: string;
  type: 'image' | 'video' | 'document' | 'audio' | 'myaudio' | 'ptt' | 'sticker';
  file: string;  // URL ou base64
  text?: string;
}

export interface UazapiSendMediaResponse {
  status?: string;
  messageId?: string;
  id?: string;
}

export interface UazapiGroup {
  JID: string;
  Name: string;
  OwnerJID?: string;
  GroupCreated?: number;
  ParticipantCount?: number;
}

export interface ViewportConfig {
  width: number;
  height: number;
}

// Configuração de recorte (clip) para screenshots
export interface ClipConfig {
  x: number;      // Posição X do canto superior esquerdo
  y: number;      // Posição Y do canto superior esquerdo
  width: number;  // Largura do recorte
  height: number; // Altura do recorte
}

// Configuração de aba específica para um grupo
export interface SheetTabConfig {
  groupId: string;
  groupName?: string;
  tabName: string;      // Nome da aba (gid) ex: "Vendas", "Resumo"
  tabGid?: string;      // ID da aba no Google Sheets (gid=xxx)
}

export interface ScheduleConfig {
  name: string;
  sheetUrl: string;
  groups: string[];
  cron: string;
  messageTemplate: string;
  viewport?: ViewportConfig;
  selector?: string;
  clip?: ClipConfig;  // Região de recorte do screenshot
  waitAfterLoad?: number;
  sheetTabs?: SheetTabConfig[];  // Configuração de abas por grupo
  cellMappings?: CellMapping[];  // Mapeamento de células para variáveis
}

export interface SettingsConfig {
  timezone: string;
  delayBetweenMessages: number;
  delayBetweenGroups: number;
  pageTimeout: number;
  waitAfterLoad: number;
}

export interface BrowserConfig {
  headless: boolean;
  defaultViewport: ViewportConfig;
}

export interface AppConfig {
  evolution?: EvolutionConfig;
  uazapi?: UazapiConfig;
  settings: SettingsConfig;
  browser: BrowserConfig;
  schedules: ScheduleConfig[];
}

// Tipos para Evolution API
export interface EvolutionConnectionState {
  instance: string;
  state: 'open' | 'close' | 'connecting';
}

export interface EvolutionSendMediaPayload {
  number: string;
  mediatype: 'image' | 'video' | 'audio' | 'document';
  mimetype: string;
  caption: string;
  media: string; // base64
}

export interface EvolutionSendMediaResponse {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  message: {
    imageMessage?: {
      url: string;
      mimetype: string;
      caption: string;
    };
  };
  messageTimestamp: string;
  status: string;
}

// Configuração de mapeamento de células da planilha
export interface CellMapping {
  variable: string;  // Nome da variável no template, ex: "valorDia"
  cell: string;      // Referência da célula, ex: "B2"
}

// Tipos para template variables
export interface TemplateVariables {
  date: string;
  time: string;
  datetime: string;
  week: string;
  weekday: string;
  scheduleName: string;
  [key: string]: string;  // Permite variáveis dinâmicas da planilha
}

// Tipos para grupos do WhatsApp
export interface WhatsAppGroup {
  id: string;
  subject: string;
  subjectOwner?: string;
  subjectTime?: number;
  creation?: number;
  size?: number;
  desc?: string;
  descId?: string;
  restrict?: boolean;
  announce?: boolean;
}

// Tipos para QR Code da Evolution API
export interface EvolutionQRCode {
  pairingCode?: string;
  code?: string;
  base64?: string;
  count?: number;
}

export interface EvolutionInstanceInfo {
  instanceName: string;
  instanceId?: string;
  status?: string;
  owner?: string;
  profileName?: string;
  profilePictureUrl?: string;
}
