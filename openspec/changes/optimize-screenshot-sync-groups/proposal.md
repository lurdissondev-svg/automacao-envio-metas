# Change: Otimizar Screenshot e Sincronizar Grupos Automaticamente

## Why

Atualmente o sistema tem dois problemas principais:
1. **Screenshot lento**: Cada screenshot abre nova página, navega, espera renderização e fecha. Para múltiplas abas, isso é muito demorado.
2. **Lista de grupos desatualizada**: O sistema só busca grupos quando o usuário clica manualmente. Grupos novos não aparecem automaticamente.

## What Changes

### 1. Otimização de Screenshot
- Manter página/browser persistente entre capturas
- Implementar cache de páginas por URL base (planilha)
- Reutilizar sessão autenticada do Google Sheets
- Captura paralela para múltiplas abas da mesma planilha

### 2. Sincronização Automática de Grupos
- Buscar lista de grupos automaticamente ao iniciar servidor
- Atualização periódica a cada 5 minutos
- Cache local de grupos com timestamp
- Endpoint para forçar refresh manual

## Impact

- **Affected specs**: screenshot-capture, group-sync (novos)
- **Affected code**:
  - `src/screenshot.ts` - reutilização de páginas
  - `src/uazapi.ts` - cache de grupos
  - `src/server.ts` - endpoints e jobs de sincronização
  - `src/scheduler.ts` - uso de screenshots em paralelo

## Benefits

- Redução de ~70% no tempo de captura de screenshots
- Lista de grupos sempre atualizada
- Menor consumo de memória (menos instâncias de página)
- Melhor experiência na interface web
