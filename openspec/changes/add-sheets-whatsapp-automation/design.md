# Design: Automação de Envio de Screenshots do Google Sheets para WhatsApp

## Context
O projeto visa automatizar o envio diário de capturas de tela de planilhas Google Sheets para grupos do WhatsApp usando a Evolution API v2. A automação será executada em uma VPS, garantindo disponibilidade contínua sem depender de máquinas locais.

### Stakeholders
- Equipes que precisam receber informações de metas diariamente
- Administradores do sistema que configuram as automações

### Constraints
- Dependência de acesso à internet na VPS
- Limites de rate da Evolution API e do Google
- Google Sheets deve estar acessível (público ou com credenciais de serviço)

## Goals / Non-Goals

### Goals
- Capturar screenshots de planilhas Google Sheets em intervalos configuráveis
- Enviar mensagens com imagens para grupos específicos do WhatsApp
- Suportar mensagens variáveis (templates com placeholders)
- Permitir configuração de múltiplos grupos e horários
- Deploy simples em VPS com Docker

### Non-Goals
- Interface gráfica para configuração
- Edição ou manipulação de dados na planilha
- Integração com outros serviços de mensagem
- Alta disponibilidade ou failover automático

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           VPS                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Scheduler     │  │   Main Script   │  │  Evolution API  │ │
│  │   (cron/node)   │──│   (Node.js)     │──│     v2          │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│           │                   │                    │            │
│           │                   │                    │            │
│           ▼                   ▼                    ▼            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Config File   │  │   Playwright    │  │    WhatsApp     │ │
│  │   (JSON/YAML)   │  │   (Screenshot)  │  │    Groups       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Google Sheets  │
                    │     (Web)       │
                    └─────────────────┘
```

## Decisions

### 1. Linguagem e Runtime: Node.js com TypeScript
**Decisão**: Usar Node.js com TypeScript para o script principal.
**Razão**:
- Playwright tem excelente suporte em Node.js
- Evolution API v2 é bem documentada para uso com JavaScript/TypeScript
- Facilita manutenção e tipagem estática

**Alternativas consideradas**:
- Python com Selenium: Mais pesado, menos integração nativa com Evolution API
- Go: Mais complexo para manipulação de browser

### 2. Captura de Screenshots: Playwright com Chrome do Host
**Decisão**: Usar Playwright conectando ao Chrome já instalado na VPS.
**Razão**:
- **Auto-wait nativo**: Aguarda automaticamente elementos ficarem prontos, reduzindo flakiness
- **Reutiliza Chrome existente**: Usa o Chrome já instalado na VPS via `executablePath`
- **Container leve**: Não precisa incluir browser no container Docker
- **Melhor estabilidade**: Menos problemas de race condition comparado ao Puppeteer
- **API mais moderna**: Tipagem TypeScript nativa e API mais intuitiva

**Alternativas consideradas**:
- Puppeteer: API similar mas menos estável, auto-wait manual
- Browser embutido no container: Imagem muito pesada, duplicação de recursos
- Google Sheets API + geração de imagem: Mais complexo, não captura formatação visual

### 3. Agendamento: Node-cron ou Cron do Sistema
**Decisão**: Usar node-cron para agendamento interno ao script.
**Razão**:
- Configuração mais simples em arquivo único
- Logs centralizados
- Facilita múltiplos horários por grupo

**Alternativas consideradas**:
- Cron do sistema: Mais robusto mas configuração separada
- Systemd timers: Mais complexo de configurar

### 4. Configuração: Arquivo JSON/YAML
**Decisão**: Usar arquivo de configuração YAML para definir grupos, horários e mensagens.
**Razão**:
- Fácil de editar manualmente
- Suporta comentários (YAML)
- Pode ser versionado

### 5. Deploy: Integração ao Docker Compose Existente
**Decisão**: Adicionar serviço ao docker-compose existente na VPS, usando Chrome do host.
**Razão**:
- Integra com infraestrutura já existente
- Reutiliza Evolution API já rodando na VPS
- Container leve (sem browser embutido)
- Chrome do host montado via volume/socket

**Configuração**:
- Montar `/usr/bin/google-chrome` ou path do Chrome no container
- Montar bibliotecas necessárias do host
- Conectar à rede do docker-compose existente

## Data Flow

```
1. [Scheduler] Trigger no horário configurado
       │
       ▼
2. [Config] Ler configuração (grupo, URL da planilha, template)
       │
       ▼
3. [Playwright] Navegar para Google Sheets URL
       │
       ▼
4. [Playwright] Aguardar carregamento (auto-wait) e capturar screenshot
       │
       ▼
5. [Template] Processar mensagem com variáveis (data, hora, etc.)
       │
       ▼
6. [Evolution API] Enviar imagem + mensagem para grupo WhatsApp
       │
       ▼
7. [Logger] Registrar sucesso/falha
```

## Configuration Schema

```yaml
# config.yaml
evolution:
  baseUrl: "http://localhost:8080"
  apiKey: "your-api-key"
  instanceName: "your-instance"

schedules:
  - name: "Metas Diárias - Vendas"
    sheetUrl: "https://docs.google.com/spreadsheets/d/xxx/edit#gid=0"
    groups:
      - "5511999999999-group@g.us"
    cron: "0 9 * * 1-5"  # 9h de segunda a sexta
    messageTemplate: |
      📊 *Atualização de Metas - {{date}}*

      Segue o relatório diário de vendas.

      Bom dia a todos! 🚀

  - name: "Metas Semanais"
    sheetUrl: "https://docs.google.com/spreadsheets/d/yyy/edit#gid=0"
    groups:
      - "5511888888888-group@g.us"
    cron: "0 8 * * 1"  # 8h toda segunda
    messageTemplate: |
      📈 *Resumo Semanal - Semana {{week}}*

      Confira nosso desempenho da semana!
```

## Risks / Trade-offs

### Risco: Bloqueio do WhatsApp
- **Mitigação**: Usar Evolution API com instância autenticada, respeitar rate limits, evitar envios em massa simultâneos

### Risco: Alterações na estrutura do Google Sheets
- **Mitigação**: Screenshots são visuais e independentes de estrutura de dados

### Risco: VPS indisponível
- **Mitigação**: Logs de execução, alertas de falha via email/webhook (futuro)

### Trade-off: Playwright vs API do Google
- Playwright captura visual real mas requer browser headless
- API do Google seria mais leve mas não captura formatação visual

## File Structure

```
automação-envio-de-metas/
├── src/
│   ├── index.ts              # Entry point
│   ├── scheduler.ts          # Gerenciamento de agendamentos
│   ├── screenshot.ts         # Captura de screenshots com Playwright
│   ├── evolution.ts          # Cliente da Evolution API v2
│   ├── config.ts             # Carregamento de configuração
│   └── templates.ts          # Processamento de templates de mensagem
├── config/
│   └── config.yaml           # Configuração principal
├── docker/
│   └── docker-compose.yml    # Setup com Evolution API
├── Dockerfile                # Build da aplicação
├── package.json
├── tsconfig.json
└── .env.example              # Variáveis de ambiente exemplo
```

## Evolution API v2 Integration

### Endpoints utilizados:
- `POST /message/sendMedia/{instance}` - Enviar imagem com caption
- `GET /instance/connectionState/{instance}` - Verificar conexão

### Payload de envio:
```json
{
  "number": "5511999999999-group@g.us",
  "mediatype": "image",
  "mimetype": "image/png",
  "caption": "Mensagem do template",
  "media": "base64_encoded_image"
}
```

## Migration Plan
N/A - Novo projeto, sem migração necessária.

## Open Questions

1. **Autenticação no Google Sheets**: As planilhas serão públicas ou precisamos de service account para acesso?
2. **Quantidade de grupos**: Quantos grupos serão configurados inicialmente?
3. **Horários específicos**: Quais são os horários desejados para cada envio?
4. **Seleção de área**: Deve capturar a planilha inteira ou uma região específica (ex: A1:F20)?
5. **Retry policy**: Em caso de falha, tentar novamente automaticamente?
