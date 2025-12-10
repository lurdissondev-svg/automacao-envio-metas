# Scheduling

## ADDED Requirements

### Requirement: Cron-based Scheduling
O sistema SHALL executar automações baseadas em expressões cron.

#### Scenario: Execução em horário agendado
- **WHEN** o horário atual corresponde à expressão cron de um schedule
- **THEN** o sistema inicia a captura de screenshot
- **AND** envia para os grupos configurados

#### Scenario: Múltiplos schedules
- **WHEN** múltiplos schedules estão configurados
- **THEN** cada um é executado independentemente no seu horário
- **AND** schedules no mesmo horário são executados em sequência

### Requirement: Schedule Configuration
O sistema SHALL permitir configuração flexível de agendamentos via arquivo de configuração.

#### Scenario: Configuração de schedule
- **GIVEN** um arquivo de configuração YAML/JSON
- **WHEN** o sistema é iniciado
- **THEN** carrega todos os schedules definidos
- **AND** registra os próximos horários de execução nos logs

#### Scenario: Configuração inválida
- **WHEN** uma expressão cron é inválida
- **THEN** o sistema registra erro e ignora o schedule inválido
- **AND** continua operando com schedules válidos

### Requirement: Timezone Support
O sistema SHALL suportar configuração de timezone para os agendamentos.

#### Scenario: Timezone configurado
- **WHEN** um timezone é especificado (ex: America/Sao_Paulo)
- **THEN** os horários são calculados de acordo com esse timezone

#### Scenario: Timezone padrão
- **WHEN** nenhum timezone é especificado
- **THEN** usa o timezone do sistema (padrão: America/Sao_Paulo)

### Requirement: Logging
O sistema SHALL manter logs detalhados de todas as execuções.

#### Scenario: Log de execução bem-sucedida
- **WHEN** um schedule é executado com sucesso
- **THEN** registra: timestamp, nome do schedule, grupos notificados, tempo de execução

#### Scenario: Log de falha
- **WHEN** uma execução falha
- **THEN** registra: timestamp, nome do schedule, tipo de erro, mensagem de erro, stack trace

### Requirement: Health Check
O sistema SHALL expor status de saúde para monitoramento.

#### Scenario: Endpoint de health check
- **WHEN** uma requisição GET é feita para /health
- **THEN** retorna status da aplicação, última execução, próxima execução agendada

#### Scenario: Verificação de dependências
- **WHEN** o health check é executado
- **THEN** verifica conexão com Evolution API
- **AND** reporta status de cada dependência

### Requirement: Graceful Startup and Shutdown
O sistema SHALL iniciar e encerrar de forma graciosa.

#### Scenario: Startup
- **WHEN** o sistema é iniciado
- **THEN** valida configuração
- **AND** testa conexão com Evolution API
- **AND** registra schedules ativos nos logs
- **AND** inicia o scheduler

#### Scenario: Shutdown
- **WHEN** o sistema recebe sinal de encerramento (SIGTERM/SIGINT)
- **THEN** aguarda jobs em execução finalizarem
- **AND** encerra o scheduler de forma limpa
- **AND** fecha conexões abertas
