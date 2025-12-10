// Tipos para configuração
export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

export interface ViewportConfig {
  width: number;
  height: number;
}

export interface ScheduleConfig {
  name: string;
  sheetUrl: string;
  groups: string[];
  cron: string;
  messageTemplate: string;
  viewport?: ViewportConfig;
  selector?: string;
  waitAfterLoad?: number;
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
  evolution: EvolutionConfig;
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

// Tipos para template variables
export interface TemplateVariables {
  date: string;
  time: string;
  datetime: string;
  week: string;
  weekday: string;
  scheduleName: string;
}
