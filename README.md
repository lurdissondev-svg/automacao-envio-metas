# Automação de Envio de Metas - Google Sheets para WhatsApp

Sistema de automação que captura screenshots de planilhas Google Sheets e envia para grupos do WhatsApp em horários agendados, utilizando a Evolution API v2.

## Funcionalidades

- 📸 Captura automática de screenshots de Google Sheets
- 📱 Envio para múltiplos grupos do WhatsApp via Evolution API v2
- ⏰ Agendamento flexível com expressões cron
- 📝 Templates de mensagem com variáveis dinâmicas
- 🐳 Integração com Docker Compose existente
- 🖥️ Usa Chrome do host (container leve)

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                           VPS                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Scheduler     │  │   Main Script   │  │  Evolution API  │ │
│  │   (node-cron)   │──│   (Node.js)     │──│     v2          │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│           │                   │                    │            │
│           ▼                   ▼                    ▼            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Config File   │  │   Playwright    │  │    WhatsApp     │ │
│  │   (YAML)        │  │   + Chrome Host │  │    Groups       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Pré-requisitos

- VPS com Docker e Docker Compose instalados
- Google Chrome instalado na VPS
- Evolution API v2 rodando (pode estar no mesmo docker-compose)
- Node.js 20+ (para desenvolvimento local)

## Instalação na VPS

### 1. Clonar o repositório

```bash
cd /opt  # ou seu diretório de projetos
git clone https://github.com/lurdissondev-svg/automacao-envio-metas.git
cd automacao-envio-metas
```

### 2. Verificar path do Chrome na VPS

```bash
which google-chrome
# ou
which google-chrome-stable
# ou
which chromium-browser
```

Anote o caminho retornado (ex: `/usr/bin/google-chrome`).

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Preencha as variáveis:
```env
# Chrome - usar o path encontrado no passo 2
CHROME_PATH=/usr/bin/google-chrome

# Evolution API
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=sua-api-key-aqui
EVOLUTION_INSTANCE=nome-da-sua-instancia

# Timezone
TZ=America/Sao_Paulo
```

### 4. Configurar os agendamentos

```bash
cp config/config.example.yaml config/config.yaml
nano config/config.yaml
```

Exemplo de configuração:
```yaml
evolution:
  baseUrl: "${EVOLUTION_API_URL}"
  apiKey: "${EVOLUTION_API_KEY}"
  instanceName: "${EVOLUTION_INSTANCE}"

settings:
  timezone: "America/Sao_Paulo"
  delayBetweenMessages: 3000  # ms
  delayBetweenGroups: 5000    # ms

schedules:
  - name: "Metas Diárias - Vendas"
    sheetUrl: "https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit#gid=0"
    groups:
      - "5511999999999@g.us"  # ID do grupo WhatsApp
    cron: "0 9 * * 1-5"  # 9h de segunda a sexta
    viewport:
      width: 1920
      height: 1080
    messageTemplate: |
      📊 *Atualização de Metas - {{date}}*

      Segue o relatório diário de vendas.

      Bom dia a todos! 🚀

  - name: "Metas Semanais"
    sheetUrl: "https://docs.google.com/spreadsheets/d/OUTRO_ID/edit#gid=0"
    groups:
      - "5511888888888@g.us"
    cron: "0 8 * * 1"  # 8h toda segunda
    messageTemplate: |
      📈 *Resumo Semanal - Semana {{week}}*

      Confira nosso desempenho da semana!
```

### 5. Integrar ao Docker Compose existente

Adicione o serviço ao seu `docker-compose.yml` existente:

```yaml
services:
  # ... seus outros serviços ...

  sheets-whatsapp:
    build: ./automacao-envio-metas
    container_name: sheets-whatsapp-automation
    restart: unless-stopped
    environment:
      - CHROME_PATH=/usr/bin/google-chrome
      - EVOLUTION_API_URL=${EVOLUTION_API_URL:-http://evolution-api:8080}
      - EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
      - EVOLUTION_INSTANCE=${EVOLUTION_INSTANCE}
      - TZ=America/Sao_Paulo
    volumes:
      # Chrome do host (ajuste o path se necessário)
      - /usr/bin/google-chrome:/usr/bin/google-chrome:ro
      - /usr/bin/google-chrome-stable:/usr/bin/google-chrome-stable:ro
      - /usr/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu:ro
      - /usr/share/fonts:/usr/share/fonts:ro
      # Configuração e logs
      - ./automacao-envio-metas/config:/app/config
      - ./automacao-envio-metas/logs:/app/logs
    networks:
      - default
    depends_on:
      - evolution-api  # remova se Evolution API não estiver no mesmo compose
```

**Alternativa: Se o docker-compose estiver em outro diretório**

```yaml
  sheets-whatsapp:
    build: /opt/automacao-envio-metas
    # ... resto igual ...
    volumes:
      - /opt/automacao-envio-metas/config:/app/config
      - /opt/automacao-envio-metas/logs:/app/logs
      # ... volumes do Chrome ...
```

### 6. Subir o serviço

```bash
# Rebuild e iniciar apenas este serviço
docker-compose up -d --build sheets-whatsapp

# Ou rebuild de tudo
docker-compose up -d --build
```

### 7. Verificar logs

```bash
# Logs em tempo real
docker-compose logs -f sheets-whatsapp

# Últimas 100 linhas
docker-compose logs --tail=100 sheets-whatsapp
```

## Configuração Detalhada

### Variáveis de Template

Use estas variáveis nos templates de mensagem:

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `{{date}}` | Data atual (DD/MM/YYYY) | 09/12/2025 |
| `{{time}}` | Hora atual (HH:MM) | 09:00 |
| `{{datetime}}` | Data e hora completa | 09/12/2025 09:00 |
| `{{week}}` | Número da semana no ano | 50 |
| `{{weekday}}` | Dia da semana | Segunda-feira |
| `{{scheduleName}}` | Nome do agendamento | Metas Diárias |

### Expressões Cron Comuns

| Expressão | Descrição |
|-----------|-----------|
| `0 9 * * 1-5` | 9h de segunda a sexta |
| `0 8 * * 1` | 8h toda segunda |
| `0 18 * * *` | 18h todos os dias |
| `0 9,14,18 * * 1-5` | 9h, 14h e 18h de seg-sex |
| `0 */2 * * *` | A cada 2 horas |

### Como obter o ID do grupo WhatsApp

1. No WhatsApp Web ou app, abra o grupo
2. Vá em "Dados do grupo" → "Convidar via link"
3. O ID do grupo está no formato: `5511999999999@g.us`
4. Ou use a Evolution API: `GET /group/fetchAllGroups/{instance}`

## Estrutura de Arquivos

```
automacao-envio-metas/
├── src/
│   ├── index.ts              # Entry point
│   ├── scheduler.ts          # Gerenciamento de agendamentos
│   ├── screenshot.ts         # Captura com Playwright
│   ├── evolution.ts          # Cliente Evolution API
│   ├── config.ts             # Carregamento de configuração
│   └── templates.ts          # Processamento de templates
├── config/
│   ├── config.yaml           # Configuração principal
│   └── config.example.yaml   # Exemplo de configuração
├── logs/                     # Logs da aplicação
├── docker-compose.yml        # Exemplo standalone
├── docker-compose.service.yml # Snippet para integrar
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### Chrome não encontrado no container

```bash
# Verificar se Chrome está montado corretamente
docker-compose exec sheets-whatsapp ls -la /usr/bin/google-chrome

# Verificar path do Chrome no host
which google-chrome google-chrome-stable chromium-browser
```

### Erro de permissão no Chrome

Adicione ao docker-compose:
```yaml
security_opt:
  - seccomp:unconfined
cap_add:
  - SYS_ADMIN
```

### Evolution API não conecta

```bash
# Verificar se estão na mesma rede
docker network inspect <nome-da-rede>

# Testar conexão de dentro do container
docker-compose exec sheets-whatsapp curl http://evolution-api:8080/health
```

### Screenshot em branco ou incompleto

- Aumente o `waitAfterLoad` na configuração
- Verifique se a planilha está pública ou se há autenticação configurada
- Teste o URL da planilha no browser

### Logs de debug

```bash
# Ativar logs de debug
docker-compose exec sheets-whatsapp sh -c "DEBUG=* node dist/index.js"
```

## Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Instalar Playwright browsers (desenvolvimento)
npx playwright install chromium

# Rodar em desenvolvimento
npm run dev

# Build
npm run build

# Rodar build
npm start
```

## Licença

MIT
