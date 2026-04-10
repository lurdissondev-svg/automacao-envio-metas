// Tipos para UAZAPI
export interface UazapiConfig {
  baseUrl: string;
  token: string;
  instanceId: string;
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
  qrcode?: string;
  paircode?: string;
  instance?: {
    qrcode?: string;
    paircode?: string;
    status?: string;
  };
}

export interface UazapiSendTextResponse {
  status?: string;
  messageId?: string;
  id?: string;
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

export interface ScheduleConfig {
  name: string;
  message: string;
  groups: string[];
  cron: string;
  stickerPath?: string;
}

export interface SettingsConfig {
  timezone: string;
  delayBetweenMessages: number;
  delayBetweenGroups: number;
}

export interface AppConfig {
  uazapi?: UazapiConfig;
  settings: SettingsConfig;
  schedules: ScheduleConfig[];
}
