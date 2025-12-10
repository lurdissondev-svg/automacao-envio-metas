# Change: Automação de Envio de Screenshots do Google Sheets para WhatsApp

## Why
Automatizar o envio diário de capturas de tela (screenshots) de planilhas Google Sheets para grupos do WhatsApp, permitindo o acompanhamento de metas de forma visual e automatizada. Elimina a necessidade de intervenção manual para compartilhar informações de desempenho com equipes.

## What Changes
- **ADDED**: Sistema de captura de screenshots do Google Sheets
- **ADDED**: Integração com Evolution API v2 para envio de mensagens no WhatsApp
- **ADDED**: Sistema de agendamento para execução em horários específicos
- **ADDED**: Configuração de mensagens variáveis (templates com dados dinâmicos)
- **ADDED**: Suporte a múltiplos grupos do WhatsApp
- **ADDED**: Infraestrutura para deploy em VPS

## Impact
- Affected specs:
  - `google-sheets-capture` (nova capability)
  - `whatsapp-messaging` (nova capability)
  - `scheduling` (nova capability)
- Affected code:
  - Script principal de automação
  - Configurações de ambiente
  - Docker/docker-compose para deploy
  - Arquivos de configuração da Evolution API

## Scope
Este projeto é uma nova implementação do zero, sem código existente para modificar.

## Out of Scope
- Interface gráfica de administração
- Dashboard de monitoramento avançado
- Suporte a outros canais de comunicação além do WhatsApp
- Análise ou processamento dos dados das planilhas
