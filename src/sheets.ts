import { logger } from './logger.js';

// Configuração de mapeamento de células
export interface CellMapping {
  variable: string;  // Nome da variável no template, ex: "valorDia"
  cell: string;      // Referência da célula, ex: "B2" ou "Sheet1!B2"
}

export interface SheetDataConfig {
  sheetId: string;
  mappings: CellMapping[];
}

// Extrair ID da planilha a partir da URL
export function extractSheetId(url: string): string | null {
  // Formato: https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// Extrair GID da aba a partir da URL
export function extractGid(url: string): string | null {
  const match = url.match(/[#&]gid=(\d+)/);
  return match ? match[1] : null;
}

// Buscar dados de células específicas usando a API pública do Google Sheets
// Usa o formato CSV público que não requer autenticação
export async function fetchSheetData(
  sheetUrl: string,
  cellMappings: CellMapping[]
): Promise<Record<string, string>> {
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) {
    logger.error('Não foi possível extrair ID da planilha', { url: sheetUrl });
    return {};
  }

  const gid = extractGid(sheetUrl) || '0';

  try {
    // Usar a API de exportação CSV pública
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

    logger.debug('Buscando dados da planilha', { sheetId, gid });

    const response = await fetch(csvUrl);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Planilha não está pública. Configure o compartilhamento como "Qualquer pessoa com o link pode ver" no Google Sheets.`);
      }
      throw new Error(`Erro ao buscar planilha: ${response.status}`);
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);

    // Extrair valores das células mapeadas
    const result: Record<string, string> = {};

    for (const mapping of cellMappings) {
      const value = getCellValue(rows, mapping.cell);
      result[mapping.variable] = value;
      logger.debug(`Célula ${mapping.cell} -> ${mapping.variable}: "${value}"`);
    }

    return result;
  } catch (error) {
    logger.error('Erro ao buscar dados da planilha', {
      error: error instanceof Error ? error.message : error,
      sheetUrl,
    });
    return {};
  }
}

// Parser simples de CSV
function parseCSV(csvText: string): string[][] {
  const rows: string[][] = [];
  const lines = csvText.split('\n');

  for (const line of lines) {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    cells.push(current.trim());
    rows.push(cells);
  }

  return rows;
}

// Converter referência de célula (ex: "B2") para índices
function parseCellReference(cell: string): { row: number; col: number } | null {
  // Remove nome da aba se presente (ex: "Sheet1!B2" -> "B2")
  const cellRef = cell.includes('!') ? cell.split('!')[1] : cell;

  const match = cellRef.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;

  const colLetters = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10);

  // Converter letras para índice (A=0, B=1, AA=26, etc)
  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 64);
  }

  return {
    row: rowNum - 1, // 0-indexed
    col: col - 1,    // 0-indexed
  };
}

// Obter valor de uma célula específica
function getCellValue(rows: string[][], cellRef: string): string {
  const parsed = parseCellReference(cellRef);
  if (!parsed) {
    logger.warn(`Referência de célula inválida: ${cellRef}`);
    return '';
  }

  const { row, col } = parsed;

  if (row >= rows.length || row < 0) {
    return '';
  }

  if (col >= rows[row].length || col < 0) {
    return '';
  }

  return rows[row][col];
}

// Buscar dados com cache simples
const cache = new Map<string, { data: Record<string, string>; timestamp: number }>();
const CACHE_TTL = 30000; // 30 segundos

export async function fetchSheetDataCached(
  sheetUrl: string,
  cellMappings: CellMapping[]
): Promise<Record<string, string>> {
  const cacheKey = `${sheetUrl}:${JSON.stringify(cellMappings)}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug('Usando dados em cache');
    return cached.data;
  }

  const data = await fetchSheetData(sheetUrl, cellMappings);
  cache.set(cacheKey, { data, timestamp: Date.now() });

  return data;
}

// Limpar cache
export function clearSheetCache(): void {
  cache.clear();
}

// Construir URL da planilha com aba específica
// Aceita: gid numérico (ex: "1505490751") ou nome da aba (ex: "SPA")
export function buildSheetUrlWithTab(baseUrl: string, tabIdentifier?: string): string {
  if (!tabIdentifier) {
    return baseUrl;
  }

  // Extrair ID da planilha
  const sheetId = extractSheetId(baseUrl);
  if (!sheetId) {
    return baseUrl;
  }

  // Verificar se é um gid numérico ou nome de aba
  const isGid = /^\d+$/.test(tabIdentifier);

  if (isGid) {
    // É um gid numérico - usar diretamente
    return `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${tabIdentifier}`;
  } else {
    // É um nome de aba - precisamos descobrir o gid
    // Por enquanto, tentar buscar da URL original se tiver a estrutura certa
    // O Google Sheets não tem API pública para listar abas sem autenticação
    // Então vamos assumir que o usuário passa o gid ou deixamos a aba original
    logger.warn(`Nome de aba "${tabIdentifier}" fornecido, mas não é possível resolver para gid sem autenticação. Use o número gid.`);
    return baseUrl;
  }
}

// Mapa conhecido de abas (para suporte básico a nomes de abas)
// O usuário pode popular isso através da interface
const knownTabs = new Map<string, string>();

// Registrar mapeamento de nome para gid
export function registerTabMapping(sheetId: string, tabName: string, gid: string): void {
  knownTabs.set(`${sheetId}:${tabName.toLowerCase()}`, gid);
}

// Obter gid pelo nome da aba
export function getGidByTabName(sheetId: string, tabName: string): string | null {
  return knownTabs.get(`${sheetId}:${tabName.toLowerCase()}`) || null;
}

// Tentar resolver o identificador da aba para gid
export function resolveTabToGid(baseUrl: string, tabIdentifier: string): string | null {
  const sheetId = extractSheetId(baseUrl);
  if (!sheetId) return null;

  // Se já é um gid numérico
  if (/^\d+$/.test(tabIdentifier)) {
    return tabIdentifier;
  }

  // Tentar buscar do mapa conhecido
  return getGidByTabName(sheetId, tabIdentifier);
}
