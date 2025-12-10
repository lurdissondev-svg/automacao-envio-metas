## ADDED Requirements

### Requirement: Automatic Group Synchronization
The system SHALL automatically synchronize the WhatsApp group list on startup and periodically.

#### Scenario: Sync on server start
- **WHEN** the server is started
- **THEN** the system SHALL fetch the group list automatically

#### Scenario: Periodic sync
- **WHEN** 5 minutes have passed since the last synchronization
- **THEN** the system SHALL fetch the group list automatically in background

#### Scenario: Group cache
- **WHEN** the group list is requested
- **THEN** the system SHALL return cached data if it exists and is recent (< 5 min)

### Requirement: Manual Group Refresh
The system SHALL allow manual update of the group list via API.

#### Scenario: Force refresh via endpoint
- **WHEN** a GET request is made to `/api/groups/refresh`
- **THEN** the system SHALL fetch the group list immediately, ignoring the cache

#### Scenario: Refresh response
- **WHEN** the manual refresh is executed successfully
- **THEN** the system SHALL return the updated group list and synchronization timestamp

### Requirement: Group Cache with Timestamp
The system SHALL maintain a local cache of groups with information about when it was updated.

#### Scenario: Cache info in endpoint
- **WHEN** a GET request is made to `/api/groups`
- **THEN** the response SHALL include the last synchronization timestamp

#### Scenario: Invalid cache
- **WHEN** the cache is older than 10 minutes
- **THEN** the system SHALL fetch new data automatically before returning
