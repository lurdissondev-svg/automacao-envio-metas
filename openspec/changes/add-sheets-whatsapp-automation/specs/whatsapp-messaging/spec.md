# WhatsApp Messaging

## ADDED Requirements

### Requirement: Evolution API Integration
O sistema SHALL integrar com a Evolution API v2 para envio de mensagens no WhatsApp.

#### Scenario: Conexão com Evolution API
- **WHEN** o sistema é iniciado
- **THEN** valida a conexão com a Evolution API usando as credenciais configuradas
- **AND** verifica se a instância do WhatsApp está conectada

#### Scenario: Instância desconectada
- **WHEN** a instância do WhatsApp não está conectada
- **THEN** o sistema registra aviso nos logs
- **AND** tenta reconectar ou aguarda reconexão manual

### Requirement: Send Image with Caption
O sistema SHALL enviar imagens (screenshots) com mensagens de texto para grupos do WhatsApp.

#### Scenario: Envio de imagem com sucesso
- **WHEN** um screenshot é capturado com sucesso
- **AND** um grupo de destino está configurado
- **THEN** o sistema envia a imagem como media
- **AND** inclui a mensagem do template como caption
- **AND** registra sucesso nos logs

#### Scenario: Falha no envio
- **WHEN** o envio para a Evolution API falha
- **THEN** o sistema registra o erro com detalhes da resposta
- **AND** não tenta reenviar automaticamente (configurável)

### Requirement: Multiple Groups Support
O sistema SHALL suportar envio para múltiplos grupos do WhatsApp.

#### Scenario: Envio para múltiplos grupos
- **WHEN** múltiplos grupos estão configurados para um schedule
- **THEN** o sistema envia a mesma imagem e mensagem para todos os grupos
- **AND** respeita um delay entre envios para evitar rate limiting

#### Scenario: Falha em um grupo não afeta outros
- **WHEN** o envio para um grupo específico falha
- **THEN** o sistema continua enviando para os demais grupos
- **AND** registra qual grupo falhou

### Requirement: Message Templates
O sistema SHALL suportar templates de mensagem com variáveis dinâmicas.

#### Scenario: Substituição de variáveis
- **WHEN** um template contém placeholders como {{date}}, {{time}}, {{week}}
- **THEN** o sistema substitui pelos valores atuais antes do envio

#### Scenario: Variáveis disponíveis
- **GIVEN** as seguintes variáveis estão disponíveis:
  - `{{date}}` - Data atual (DD/MM/YYYY)
  - `{{time}}` - Hora atual (HH:MM)
  - `{{datetime}}` - Data e hora completa
  - `{{week}}` - Número da semana no ano
  - `{{weekday}}` - Dia da semana (Segunda, Terça, etc.)
  - `{{scheduleName}}` - Nome do agendamento
- **WHEN** o template usa qualquer dessas variáveis
- **THEN** são substituídas pelo valor correspondente

### Requirement: Rate Limiting
O sistema SHALL respeitar limites de taxa para evitar bloqueios.

#### Scenario: Delay entre mensagens
- **WHEN** múltiplas mensagens são enviadas em sequência
- **THEN** o sistema aguarda um intervalo configurável entre cada envio (padrão: 3 segundos)

#### Scenario: Delay entre grupos
- **WHEN** enviando para múltiplos grupos no mesmo schedule
- **THEN** o sistema aguarda intervalo configurável entre grupos (padrão: 5 segundos)
