## ADDED Requirements

### Requirement: Persistent Browser Page Pool
The system SHALL maintain a pool of persistent browser pages for reuse between screenshot captures.

#### Scenario: Reuse existing page
- **WHEN** a screenshot capture is requested for a URL already open in the pool
- **THEN** the system SHALL reuse the existing page instead of creating a new one

#### Scenario: Create new page when needed
- **WHEN** a screenshot capture is requested for a URL not present in the pool
- **THEN** the system SHALL create a new page and add it to the pool

#### Scenario: Cleanup inactive pages
- **WHEN** a page in the pool has not been used for more than 5 minutes
- **THEN** the system SHALL close and remove the page from the pool automatically

### Requirement: Parallel Screenshot Capture
The system SHALL support parallel screenshot capture for multiple tabs of the same spreadsheet.

#### Scenario: Parallel tab capture
- **WHEN** a schedule has multiple groups with different tabs from the same spreadsheet
- **THEN** the system SHALL capture screenshots in parallel instead of sequentially

#### Scenario: Parallel capture limit
- **WHEN** more than 5 parallel captures are requested
- **THEN** the system SHALL limit to 5 simultaneous captures to avoid overload

### Requirement: Session Reuse
The system SHALL maintain the authenticated Google Sheets session between captures.

#### Scenario: Authentication reuse
- **WHEN** multiple captures are made from the same spreadsheet
- **THEN** the system SHALL reuse the authenticated session without fully reloading the page
