# Document Types & Templates

Choose the right document type for your project's context and audience.

## Document Type Selection Table

| Document | Best For | Audience | Detail Level |
|----------|----------|----------|-------------|
| **SRS** (Software Requirements Specification) | Formal/regulated projects, contracts, enterprise systems, government | Engineers, QA, architects, legal | Very high — every behavior specified |
| **PRD** (Product Requirements Document) | Product-led teams, startups, agile orgs | Product, design, engineering | Medium-high — what & why, flexible on how |
| **BRD** (Business Requirements Document) | Executive alignment, project justification, funding requests | Executives, business stakeholders, PMO | High-level — business goals, ROI, KPIs |
| **FRD** (Functional Requirements Document) | Deep-dive on a single feature or module | Engineering, QA | High — detailed behavior of one feature |
| **User Stories + Epics** | Agile/scrum teams, sprint planning, incremental delivery | Dev team, product owner, scrum master | Stories with detailed acceptance criteria |
| **Use Cases** | Complex multi-actor workflows, systems with many interaction paths | Business analysts, architects, QA | Step-by-step scenario flows |

## Quick Decision Heuristic

Use this logic to select the right document type:

- **Regulated / contract / compliance context** → SRS
- **Startup or product team** → PRD
- **Need executive buy-in / budget approval** → BRD
- **Agile sprint planning** → User Stories
- **Complex multi-actor interactions** → Use Cases
- **Single feature deep-dive** → FRD

---

# SRS Template (IEEE 830 / ISO 29148 aligned)

## 1. Introduction

### 1.1 Purpose

State the purpose of this SRS document. Example: "This document specifies the
functional and non-functional requirements for the Customer Relationship
Management (CRM) system used by ABC Corporation's sales team."

### 1.2 Scope

**What is IN scope:**
- [Feature/module 1]
- [Feature/module 2]
- [Integration with external system X]

**What is OUT of scope:**
- [Explicitly not included in this release]
- [Deferred to future versions]
- [Third-party responsibilities]

### 1.3 Definitions, Acronyms, Abbreviations (Glossary)

| Term | Definition |
|------|-----------|
| User | A person with a valid login account in the system |
| Admin | A user with elevated permissions to manage other users and system settings |
| API | Application Programming Interface |

### 1.4 References

- [Standard or regulation, e.g., GDPR, NIST SP 800-63]
- [User research findings document]
- [Competitive analysis]
- [Related SRS documents if this is multi-document spec]

### 1.5 Document Overview

Provide a brief summary of the SRS structure and how to navigate it.

---

## 2. Overall Description

### 2.1 Product Perspective (System Context)

Describe the system's role in the larger environment:

```
External Systems:
┌─────────────────────────────────────────┐
│   Email Service (SendGrid)              │
│   Payment Gateway (Stripe)              │
│   Analytics Platform (Mixpanel)         │
└─────────────────────────────────────────┘
              ↕ API calls
┌─────────────────────────────────────────┐
│   Our System (CRM)                      │
└─────────────────────────────────────────┘
              ↕ Access
┌─────────────────────────────────────────┐
│   End Users (Sales Team)                │
│   Admins (Operations)                   │
└─────────────────────────────────────────┘
```

### 2.2 Product Features (High-Level Summary)

| Feature | Description | Priority |
|---------|-------------|----------|
| User Authentication | Login/logout with email/password | Must |
| Contact Management | Create, read, update, delete contacts | Must |
| Pipeline Management | Track deals through sales stages | Must |
| Reporting | Generate sales reports and dashboards | Should |
| Mobile App | iOS/Android native apps | Could |

### 2.3 User Classes and Characteristics

For each user class:

**Sales Representative**
- Goals: Manage contacts, track deals, close sales
- Tech skill level: Intermediate
- Usage frequency: Daily, 8+ hours
- Access level: Read/write own and team data

**Sales Manager**
- Goals: Oversee team pipeline, generate reports, forecast revenue
- Tech skill level: Intermediate
- Usage frequency: Daily, 2-4 hours
- Access level: Read all, write reports and forecasts

**System Administrator**
- Goals: Manage users, configure system, ensure uptime
- Tech skill level: Advanced
- Usage frequency: As needed (few times per week)
- Access level: Full administrative access

### 2.4 Operating Environment

- **Hardware**: Dell workstations, MacBook Pro, iPad
- **OS**: Windows 10+, macOS 10.15+, iOS 14+, Android 10+
- **Browsers**: Chrome 90+, Safari 14+, Firefox 88+, Edge 90+
- **Network**: 10 Mbps+ internet connection
- **Server**: AWS, availability zones in US-East and US-West
- **Database**: PostgreSQL 12+
- **Cloud**: AWS RDS for managed database

### 2.5 Design and Implementation Constraints

- Must use PostgreSQL (existing company standard)
- Must integrate with Salesforce API for data sync
- Must be GDPR compliant (customer data in EU)
- Must support SSO via Microsoft Entra ID
- Must deploy to AWS using Docker containers
- Must meet PCI-DSS 3.2.1 for payment data handling

### 2.6 Assumptions and Dependencies

**Assumptions:**
1. Users have stable internet connectivity (≥5 Mbps)
2. Microsoft Entra ID will remain the primary authentication provider
3. Salesforce API will remain available (SLA: 99.9% uptime)
4. Project team will have access to production AWS account

**Dependencies:**
1. Salesforce CRM (external system) — if unavailable, feature FR-SYNC-001 cannot
   operate
2. SendGrid email service — if unavailable, notifications cannot be sent

---

## 3. Specific Requirements

### 3.1 Functional Requirements

#### 3.1.1 User Authentication

**FR-AUTH-001**: The system shall allow users to authenticate using email
address and password.
- Priority: Must
- Source: Business requirement, user research
- Acceptance Criteria: Given valid credentials, when user submits login form,
  then system creates an authenticated session and redirects to dashboard.
- Dependencies: None
- Notes: See FR-AUTH-002 for error handling

**FR-AUTH-002**: The system shall validate email format per RFC 5322 before
form submission.
- Priority: Must
- Acceptance Criteria: Given malformed email, when user submits, then system
  displays inline error "Please enter a valid email address" without page reload.

**FR-AUTH-003**: The system shall display a generic error "Invalid email or
password" when authentication fails, without revealing which field was incorrect.
- Priority: Must
- Rationale: Security best practice to prevent user enumeration attacks
- Acceptance Criteria: Given incorrect password for valid email, when user
  submits, then system displays "Invalid email or password" (not "Incorrect
  password").

#### 3.1.2 [Feature Area 2: e.g., Contact Management]

**FR-CONTACT-001**: The system shall allow users to create a new contact record
with required fields: first name, last name, email, phone, company.
- Priority: Must
- Acceptance Criteria:
  - Given all required fields present, when user submits, then contact is created
    and user sees confirmation message
  - Given missing required field, when user submits, then form highlights missing
    field and displays "This field is required"

### 3.2 External Interface Requirements

#### 3.2.1 User Interfaces

**Login Page**
- Field: Email (email input)
  - Format: RFC 5322
  - Max length: 254 characters
  - Required: Yes
  - Validation: Real-time validation on blur
- Field: Password (password input)
  - Min length: 8 characters
  - Max length: 128 characters
  - Required: Yes
  - Validation: No real-time validation (security)
- Button: Login (primary button, full width)
- Link: Forgot Password (secondary text link below password field)

#### 3.2.2 Software Interfaces (APIs)

**POST /api/v1/auth/login**
- Request Body:
  ```json
  {
    "email": "user@example.com",
    "password": "securePassword123"
  }
  ```
- Response (200 OK):
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600,
    "user": { "id": "123", "name": "John Doe" }
  }
  ```
- Response (401 Unauthorized):
  ```json
  {
    "error": "Invalid email or password"
  }
  ```
- Rate Limiting: 5 requests per IP per minute

#### 3.2.3 Hardware Interfaces

N/A for web-based application

#### 3.2.4 Communication Interfaces

- **Protocol**: HTTPS/TLS 1.2+
- **Data Format**: JSON
- **Authentication**: Bearer token in Authorization header

### 3.3 Non-Functional Requirements

#### 3.3.1 Performance Requirements

**NFR-PERF-001**: The login page shall achieve Largest Contentful Paint (LCP)
under 2.5 seconds on a 4G connection on a standard mobile device.
- Test method: Google Lighthouse PageSpeed Insights on Chrome mobile
- Acceptance criterion: 75+ score on PageSpeed Insights

**NFR-PERF-002**: The authentication API endpoint shall respond within 500ms at
p95 latency under normal load (100 concurrent users).
- Test method: Load testing with Apache JMeter
- Acceptance criterion: 95th percentile response time ≤ 500ms

#### 3.3.2 Security Requirements

**NFR-SEC-001**: All authentication data shall be transmitted over TLS 1.2 or
higher.
- Test method: SSL Labs test on login endpoint
- Acceptance criterion: Grade A or A+

**NFR-SEC-002**: Passwords shall be hashed using bcrypt with minimum cost factor
of 12. Plaintext passwords shall never be stored or logged.
- Test method: Code review and secrets scanning
- Acceptance criterion: No plaintext passwords in logs or database dumps

**NFR-SEC-003**: The login form shall include CSRF token protection.
- Test method: Manual CSRF attack attempt
- Acceptance criterion: Requests without valid CSRF token are rejected with 403
  Forbidden

#### 3.3.3 Reliability & Availability Requirements

**NFR-REL-001**: The system shall maintain 99.9% uptime SLA, measured monthly.
- Acceptable downtime: 43.2 minutes per month
- Test method: Synthetic uptime monitoring
- Acceptance criterion: Monthly uptime report ≥ 99.9%

**NFR-REL-002**: If a failure occurs during login, the system shall gracefully
degrade by displaying "Service temporarily unavailable. Please try again in 1
minute." and queuing retry attempts.
- Test method: Chaos engineering (kill database, observe behavior)
- Acceptance criterion: User sees message within 2 seconds; automatic retry
  occurs after 1 minute

#### 3.3.4 Scalability Requirements

**NFR-SCALE-001**: The system shall support 10,000 concurrent users with login
latency not exceeding 500ms at p95.
- Test method: Load test with 10,000 concurrent login attempts
- Acceptance criterion: p95 latency ≤ 500ms during sustained load

#### 3.3.5 Maintainability Requirements

**NFR-MAINT-001**: All system events (login, logout, password reset, admin
actions) shall be logged with timestamp, user ID, IP address, user agent, action
type, and result (success/failure).
- Test method: Log inspection after key user actions
- Acceptance criterion: All 6 fields present in every log entry

#### 3.3.6 Portability Requirements

**NFR-PORT-001**: The system shall function on Chrome 90+, Safari 14+, Firefox
88+, and Edge 90+.
- Test method: Cross-browser testing
- Acceptance criterion: All features work identically on all 4 browsers

**NFR-PORT-002**: The system shall be responsive and usable on screen sizes from
320px (iPhone SE) to 4K (3840px).
- Test method: Responsive design testing
- Acceptance criterion: All content readable and interactive on min/max screen
  sizes

#### 3.3.7 Accessibility Requirements

**NFR-ACC-001**: The login form shall be fully navigable via keyboard (Tab,
Enter, Escape).
- Test method: Manual keyboard-only navigation
- Acceptance criterion: All form elements reachable via Tab; form submittable via
  Enter; form closable via Escape

**NFR-ACC-002**: The login form shall meet WCAG 2.1 AA: 4.5:1 contrast ratio for
all text, visible focus indicators on interactive elements, aria-labels on all
inputs, and error announcements via aria-live.
- Test method: WAVE accessibility tool and manual screen reader testing
- Acceptance criterion: WAVE reports 0 errors; tested with NVDA and JAWS

#### 3.3.8 Compliance Requirements

**NFR-COMP-001**: User account data shall be encrypted at rest using AES-256.
- Regulatory requirement: GDPR Article 32 (encryption)
- Test method: Database encryption verification
- Acceptance criterion: Encryption enabled on RDS instance

**NFR-COMP-002**: Upon user request, the system shall export all personal data
in machine-readable format (JSON) within 30 days.
- Regulatory requirement: GDPR Article 15 (Right to Access)
- Test method: Submit data access request, verify delivery
- Acceptance criterion: JSON file provided within 30 days

#### 3.3.9 Internationalization Requirements

**NFR-I18N-001**: The system shall support English (US, UK) and Spanish (Spain,
Mexico) with locale-specific date, time, currency, and number formatting.
- Test method: Switch locale, verify formatting
- Acceptance criterion: Date displays as MM/DD/YYYY in en-US, DD/MM/YYYY in
  en-GB, DD/MM/YYYY in es-ES

### 3.4 Data Requirements

#### 3.4.1 Logical Data Model

```
User:
- user_id (UUID, Primary Key)
- email (VARCHAR, unique, indexed)
- password_hash (VARCHAR)
- first_name (VARCHAR)
- last_name (VARCHAR)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- last_login_at (TIMESTAMP, nullable)
- is_active (BOOLEAN, default: true)

Session:
- session_id (UUID, Primary Key)
- user_id (UUID, Foreign Key → User)
- token (VARCHAR, indexed)
- expires_at (TIMESTAMP)
- ip_address (VARCHAR)
- user_agent (VARCHAR)
- created_at (TIMESTAMP)
```

#### 3.4.2 Data Retention & Archival

**DR-001**: User login sessions shall be retained for 30 days. After 30 days,
sessions shall be archived to cold storage (S3 Glacier) for 2 years, then
deleted.
- Rationale: Support historical audit; comply with GDPR retention limits

**DR-002**: Deleted user accounts and all associated data shall be permanently
removed within 14 days of deletion request (GDPR Right to be Forgotten).
- Rationale: GDPR Article 17

#### 3.4.3 Data Migration Strategy

When migrating from legacy CRM (system X):

**DR-003**: All 50,000+ existing user contacts shall be migrated to the new
system with 99.9% accuracy verification.
- Test method: Data validation comparing row counts, checksums, spot-check
  records
- Acceptance criterion: No data loss; all records migrated

#### 3.4.4 Data Backup & Recovery

**DR-004**: Full backups shall be taken daily at 2 AM UTC. Backups shall be
retained for 30 days.
- Test method: Monthly restore test (pick random daily backup, restore to test
  environment, verify data integrity)
- Acceptance criterion: Data integrity verified on restore; RPO ≤ 24 hours, RTO
  ≤ 4 hours

---

## 4. Appendices

### Appendix A: Requirements Traceability Matrix

| Req ID | Source | Business Objective | Test Case | Status |
|--------|--------|-------------------|-----------|--------|
| FR-AUTH-001 | Product Requirements | Secure Access | TC-AUTH-001 | Open |
| FR-AUTH-002 | Security Best Practice | Data Integrity | TC-AUTH-002 | Open |
| NFR-SEC-001 | GDPR Requirement | Regulatory Compliance | TC-SEC-001 | Open |

### Appendix B: Glossary

| Term | Definition |
|------|-----------|
| Bcrypt | Cryptographic hashing function for passwords |
| CSRF | Cross-Site Request Forgery — security vulnerability |
| JWT | JSON Web Token — stateless authentication token |
| LCP | Largest Contentful Paint — web performance metric |
| WCAG | Web Content Accessibility Guidelines |

### Appendix C: Open Questions Log

| ID | Question | Owner | Target Date | Status |
|----|----------|-------|-------------|--------|
| Q-001 | Should we support passwordless authentication (magic links) in v1? | Product Manager | 2024-02-15 | Pending |
| Q-002 | What is the maximum acceptable data retention cost? | Finance | 2024-02-20 | Pending |

### Appendix D: Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v0.1 | 2024-01-15 | John Doe | Initial draft |
| v0.2 | 2024-01-20 | Jane Smith | Added NFR requirements; updated templates |
| v1.0 | 2024-01-30 | John Doe | Approved by steering committee |

---

# PRD Template

## 1. Overview

### 1.1 Problem Statement

State the problem in quantifiable, customer-centric terms. Include:

- What pain is the customer experiencing?
- How much does it cost them (time, money, frustration)?
- What data supports this?

Example: "Sales reps currently spend 45 minutes per day manually updating opportunity
status in Salesforce (based on 50-hour audit). This is 3.75 hours per week × 50 reps
× 52 weeks = 9,750 wasted hours annually. Estimated cost: $438,750 in lost
productivity."

### 1.2 Objectives & Key Results

Define success using SMART OKRs:

**Objective**: Reduce friction in pipeline management
- KR1: Reduce time to update opportunity status from 5 minutes to 1 minute
  (measured via usage analytics)
- KR2: Increase team pipeline accuracy from 74% to 90% (measured via forecast
  vs. actual variance)
- KR3: Increase user adoption from 60% to 85% within 60 days of launch
  (measured via login analytics)

### 1.3 Target Users / Personas

**Sales Representative — Sarah (Primary)**
- Role: Individual contributor closing deals
- Goals: Close more deals, accurate forecasting, minimize admin time
- Pain points: Manual CRM updates, visibility into pipeline
- Tech comfort: Intermediate
- Usage: Daily, 8+ hours

**Sales Manager — Mike (Secondary)**
- Role: Team leadership, forecasting
- Goals: Accurate pipeline visibility, predict quarterly revenue
- Pain points: Forecasts not reflecting reality; team doesn't use tools
- Tech comfort: Intermediate
- Usage: Daily, 2-4 hours

### 1.4 Success Metrics (SMART)

| Metric | Baseline | Target | Timeline | Measurement |
|--------|----------|--------|----------|------------|
| Feature adoption | 0% | 80% | 90 days | % of daily active users using new feature |
| Time per update | 5 min | 1 min | 30 days | Session analysis post-launch |
| Forecast accuracy | 74% | 88% | 60 days | Forecast vs. actual variance |
| Net satisfaction | — | 8.0/10 | 45 days | In-app survey (System Usability Scale) |

---

## 2. Background & Context

### 2.1 Current State & Pain Points

**How things work today:**

Sales reps log into Salesforce, find the opportunity record, click Edit, change
status from "Negotiation" to "Proposal Sent", click Save, return to list view.
Average: 4-5 minutes per update. Some reps skip updates; team lead manually audits
and corrects weekly.

**Supporting data:**
- Time audit of 10 reps × 10 weeks = 450 wasted hours/year
- Survey: 73% of reps say "updating Salesforce is tedious"
- 35% of forecasts diverge >10% from actual (accuracy problem)

### 2.2 Competitive Analysis

| Feature | Our Product | Competitor A | Competitor B |
|---------|------------|--------------|--------------|
| Quick status update | No (new) | Yes | Yes |
| Mobile app | No | Yes | No |
| Forecast accuracy tools | No | Yes | Yes |
| Slack integration | No | Yes | Yes |

**Gap**: We're missing quick-update workflow. Competitors have this. Risk: reps
choose competitor solutions.

### 2.3 User Research Insights

**Key findings from 15 sales rep interviews (Jan 2024):**

- 92% say updating CRM is their biggest productivity drain
- 80% would pay for a single-click status update
- 100% want mobile access for on-the-go updates
- 67% want Slack notifications of opportunities approaching close date

---

## 3. Solution

### 3.1 Feature Summary Table

| Feature | Description | Priority | Effort | Impact |
|---------|-------------|----------|--------|--------|
| Quick Status Update (Kanban board) | Drag-and-drop opportunity cards to change status | Must | L | High |
| Mobile app | iOS/Android native apps for on-the-go access | Should | XL | High |
| Slack integration | Receive notifications of deal milestones | Should | M | Medium |
| Bulk actions | Update multiple opportunities at once | Could | M | Medium |
| Custom fields | Add org-specific custom fields to Kanban | Could | M | Low |

### 3.2 User Flows

**Happy path: Sales rep updates opportunity status via Kanban**
```
1. Rep opens Kanban view
2. Sees opportunities in columns: Lead, Qualified, Proposal, Negotiation, Closed
3. Drags "ABC Corp" card from Negotiation → Proposal
4. System updates Salesforce immediately
5. Manager sees updated pipeline in dashboard
```

**Alternative: Mobile update**
```
1. Rep opens mobile app
2. Sees opportunities in a list
3. Taps opportunity, taps status dropdown, selects "Proposal"
4. System syncs to Salesforce; confirmation badge shows
```

### 3.3 Detailed Feature Requirements

#### Feature 1: Quick Status Update (Kanban Board)

**Description**: A Kanban-style interface where sales opportunities appear as
cards in columns representing pipeline stages. Users can drag cards between
columns to change opportunity status instantly.

**User Stories**:

**STORY-001**: As a sales rep, I want to drag an opportunity card from
"Negotiation" to "Closed Won" so that I can update the pipeline status in one
action instead of 5 clicks.

- AC1: Given opportunity in "Negotiation" column, when rep drags card to
  "Closed Won", then system updates Salesforce record and displays success
  toast "Status updated to Closed Won" within 500ms
- AC2: Given invalid status transition (e.g., Lead → Closed Won), when rep
  attempts drag, then system displays inline error "This transition is not
  allowed per your org's Salesforce config"
- AC3: Given offline state (no network), when rep drags card, then system
  queues action locally and syncs when connection restored
- Definition of Done: Manual testing on Chrome/Safari/Firefox; Salesforce sync
  verified; permissions tested (only update own/team records); analytics event
  logged

**STORY-002**: As a sales manager, I want to see all team opportunities in
Kanban view so that I can quickly assess pipeline health.

- AC1: Given manager with "view all" permission, when manager opens Kanban, then
  system displays all 50+ team opportunities grouped by status
- AC2: Given large dataset (200+ cards), when manager scrolls, then system
  maintains smooth 60 FPS scrolling performance
- Definition of Done: Load test with 200 cards; scrolling profiled; no jank
  observed

**Business Rules**:
- BR1: Only users with "edit opportunity" permission can drag cards
- BR2: Status transitions must comply with Salesforce org's configured workflow
  rules
- BR3: Dragging updates Salesforce in real-time; no "Save" button required

**Out of Scope for this feature**:
- Custom field editing (see Feature 5)
- Bulk status changes (see Feature 4)
- Probability calculations (managed by Salesforce)

**Analytics instrumentation**:
- Event: `opportunity_status_changed`
  - Properties: old_status, new_status, opportunity_id, user_id, duration_seconds
- Event: `kanban_view_opened`
  - Properties: user_id, number_of_cards, duration_viewed_seconds

**UI specifications**:
- Kanban columns: Lead | Qualified | Proposal | Negotiation | Closed Won | Closed Lost
- Opportunity cards: 280px width, display: [Opportunity Name], [Account Name],
  [Amount], [Close Date]
- Drag interaction: 0.2s animation on drop; success toast 2s auto-dismiss
- Error state: Red border on invalid drop target; 3s error message in red

#### Feature 2: Mobile App

[Detailed user stories, acceptance criteria, business rules, out of scope, analytics]

### 3.4 Non-Functional Requirements

**NFR-PERF**: Kanban should load in under 2 seconds with 100 opportunities
**NFR-SEC**: Only show opportunities user has permission to view (row-level security)
**NFR-SCALE**: Support 500+ concurrent Kanban users
**NFR-ACC**: Kanban must be keyboard-navigable (Tab through cards, Enter to open)
**NFR-COMP**: Comply with GDPR (no PII exported)

### 3.5 Analytics & Instrumentation

| Event | When | Properties | Purpose |
|-------|------|-----------|---------|
| kanban_opened | User opens Kanban view | user_id, opportunity_count | Adoption tracking |
| status_changed | User drags card | old_status, new_status, duration_ms | Feature usage |
| kanban_error | Drag fails | error_type, opportunity_id | Quality monitoring |

---

## 4. Design

### 4.1 Wireframes / Mockups

[Links to Figma, Balsamiq, or embedded screenshots]

### 4.2 Information Architecture

**Navigation**:
- Sidebar: Sales → Opportunities → [Kanban | List | Map]
- Kanban is the new default view

---

## 5. Technical Considerations

### 5.1 API Requirements

**GET /api/v1/opportunities (new Kanban endpoint)**
- Query params: `status`, `user_id`, `limit`, `offset`
- Response: 50 opportunities with status, name, amount, close_date, owner
- Rate limiting: 100 requests/minute per user

**PATCH /api/v1/opportunities/{id} (existing endpoint, enhanced)**
- Request: `{ "status": "Closed Won" }`
- Response: Updated opportunity object
- Sync to Salesforce asynchronously (queue job)

### 5.2 Data Model Changes

No schema changes required. Uses existing `opportunities` and `salesforce_sync`
tables.

### 5.3 Third-Party Dependencies

- **Salesforce REST API** (existing integration)
  - SLA: 99.9% uptime
  - Fallback: Queue updates locally, retry every 5 minutes
- **React DnD library** for Kanban drag-drop (new open-source dependency)

### 5.4 Migration / Backward Compatibility Plan

No migration needed. Feature is additive. List view remains untouched.

### 5.5 Feature Flags & Kill Switches

- **Feature flag**: `ui.kanban_enabled` (rollout: 10% → 25% → 50% → 100%)
- **Kill switch**: If Salesforce API errors exceed 5% for 5 minutes, disable
  Kanban; fallback to list view

---

## 6. Launch Plan

### 6.1 Rollout Strategy

- **Week 1**: Beta (5 power users at one customer) — gather feedback
- **Week 2**: Controlled rollout (10% of US users) — monitor errors, performance
- **Week 3**: Expand (50% of US users)
- **Week 4**: Full rollout (100% of users)

### 6.2 Rollback Plan

**Trigger conditions for rollback**:
- Error rate >2% for >5 minutes
- Performance SLA violated (load time >3s)
- Data loss incidents (opportunities lost in Salesforce sync)

**Steps**:
1. Disable feature flag `ui.kanban_enabled`
2. Notify affected users via banner "Kanban is temporarily unavailable. Using
   list view."
3. Investigate root cause
4. Re-enable after fix verified in staging

### 6.3 Monitoring & Alerting

**Dashboards** (Datadog):
- Kanban load time (p50, p95)
- Drag-drop success rate
- Salesforce sync error rate
- User engagement (DAU, drag-drop frequency)

**Alerts** (PagerDuty):
- Error rate >2% → page on-call engineer
- Salesforce sync failures >100/hour → page on-call engineer
- Load time p95 >3s → alert Slack #platform-alerts

---

## 7. Risks & Mitigations

| Risk | Probability | Impact | Mitigation | Owner |
|------|-------------|--------|-----------|-------|
| Salesforce API rate limits exceeded | Medium | High | Implement local queue + async sync; cache frequently accessed data | Backend lead |
| Mobile app delayed; only web launched | Medium | Medium | Ship web first (meets 80% of use case); mobile in v1.1 | Product Manager |
| Data loss in Salesforce sync | Low | Critical | Implement idempotent sync; audit logging; staging test |  Backend lead |
| Users confused by multiple views (List + Kanban) | Medium | Low | Default to Kanban; bury List view; user education | Product Manager |

---

## 8. Open Questions

| ID | Question | Owner | Target Date | Decision |
|----|----------|-------|-------------|----------|
| Q-001 | Should we support custom Kanban columns per org? | Product Manager | 2024-02-15 | TBD |
| Q-002 | What level of Salesforce sync latency is acceptable (realtime vs. 30s batch)? | Eng Lead | 2024-02-10 | TBD |

---

## 9. Appendix

### Glossary

| Term | Definition |
|------|-----------|
| Kanban | Visual workflow management; cards move across columns representing stages |
| DAU | Daily Active Users |
| ROI | Return on Investment |

### References

- Salesforce API docs: https://developer.salesforce.com
- Customer research synthesis: https://docs.google.com/doc/...
- Competitive analysis: https://drive.google.com/...

### Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v0.1 Draft | 2024-01-15 | Sarah Chen | Initial draft |
| v0.2 Draft | 2024-01-22 | Sarah Chen | Added design mockups; expanded test cases |
| v1.0 Approved | 2024-01-30 | VP Product | Approved for execution |

---

# User Story Template

## Epic Context

**Epic**: [Epic Name] e.g., "Pipeline Management Revolution"

**Epic Description**: [1-2 sentences describing the epic's strategic value]
Example: "Empower sales teams to manage opportunities with 80% less friction.
Reduce status update time from 5 minutes to 1 minute."

**Business Value**: [Measurable impact] Example: "Recover 9,750 productive hours
annually (50 reps × 3.75 hours/week × 52 weeks). Improve forecast accuracy from
74% to 88%."

**Epic Acceptance Criteria**:
- AC1: Kanban board is the default pipeline view for all users
- AC2: Average opportunity status update completes in <1 minute (vs. 5 min prior)
- AC3: Pipeline forecast accuracy improves to 88% within 60 days
- AC4: Mobile and web experiences both live

---

## User Story Format

**[STORY-ID]** As a [specific role/persona], I want [specific capability], so
that [measurable benefit].

**Priority**: Must / Should / Could / Won't

**Estimate**: [Story points: 1, 2, 3, 5, 8, 13 or T-shirt: XS, S, M, L, XL]

### Acceptance Criteria

Write each AC using **Given/When/Then** format (Gherkin):

**AC1**: Given [precondition], when [user action], then [expected system behavior].

**AC2**: Given [error condition], when [user action], then [error handling behavior].

**AC3**: Given [edge case], when [user action], then [boundary behavior].

**AC4**: Given [concurrent access], when [multiple users action], then [conflict
resolution behavior].

### Definition of Done

Check all items before marking story complete:

- [ ] Code written and peer-reviewed
- [ ] Unit tests written (>80% coverage of changed code)
- [ ] Integration tests passing
- [ ] Acceptance criteria verified by QA (manual sign-off or automated tests)
- [ ] No regressions in related features (smoke test)
- [ ] Documentation updated (API docs, help center, changelog)
- [ ] Analytics events verified (correct events fired with correct properties)
- [ ] Accessibility tested (WCAG 2.1 AA, screen reader, keyboard navigation)
- [ ] Performance tested (load time, API latency verified under load)
- [ ] Secrets scanning run (no hardcoded keys, passwords, API tokens)
- [ ] Merged to main branch and deployed to staging

### Technical Notes

- **API endpoints affected**: [List any new or modified endpoints]
  - Example: POST /api/v1/opportunities/bulk-update (new)
  - Example: PATCH /api/v1/opportunities/{id} (enhanced)
- **Data model changes**: [Any DB schema updates needed]
  - Example: Add `last_status_updated_at` timestamp to opportunities table
- **Dependencies on other services**: [External APIs, databases, queues]
  - Example: Depends on Salesforce REST API (must complete STORY-123 first for
    integration)
- **Performance constraints**: [Load, latency, memory considerations]
  - Example: Handle bulk update of 10,000 records in <30 seconds

### Dependencies

[List other stories that must complete first]

Example:
- Blocks: STORY-125 (Kanban UI depends on this API)
- Blocked By: STORY-122 (Salesforce integration must be complete first)

### Out of Scope

Explicitly state what this story does NOT include:

- Custom Kanban columns (defer to Story-XYZ)
- Bulk actions (defer to Story-XYZ)
- Mobile app version (defer to Story-XYZ)

---

## Story Splitting Strategies (for Large Stories)

Use these patterns to break oversized stories into sprint-sized pieces:

### 1. By Workflow Step

Instead of: "User can upload a file, extract data, validate, and export results"

Split into:
- STORY-A: User can upload a file
- STORY-B: System extracts structured data
- STORY-C: User can validate extracted data
- STORY-D: User can export to CSV/JSON

### 2. By Data Variation

Instead of: "User can pay with credit card, Apple Pay, Google Pay"

Split into:
- STORY-A: User can pay with credit card
- STORY-B: User can pay with Apple Pay
- STORY-C: User can pay with Google Pay

### 3. By Business Rule

Instead of: "System calculates price: base + discount (if applicable) + tax (by
region)"

Split into:
- STORY-A: Calculate base price
- STORY-B: Apply discount rules
- STORY-C: Apply tax rules (geography-aware)

### 4. By Interface

Instead of: "User can filter products on web, mobile, and API"

Split into:
- STORY-A: Web filtering UI
- STORY-B: Mobile filtering UI
- STORY-C: API filtering endpoint

### 5. By CRUD Operation

Instead of: "User can manage products (create, read, update, delete)"

Split into:
- STORY-A: User can create products
- STORY-B: User can view products
- STORY-C: User can edit products
- STORY-D: User can delete products

### 6. By Role / User Type

Instead of: "Admins can view and edit configuration for all customers"

Split into:
- STORY-A: Admin can view customer config
- STORY-B: Admin can edit basic config
- STORY-C: Admin can manage advanced settings

### 7. By Happy Path + Error Handling

Instead of: "User submits payment and system handles success, validation errors,
timeout, and network failures"

Split into:
- STORY-A: Happy path — user submits valid payment and sees confirmation
- STORY-B: Error handling — system handles validation errors gracefully
- STORY-C: Resilience — system handles timeouts and retries

---

# Use Case Template

## Use Case ID: UC-XXX

**Name**: [Verb Phrase, e.g., "Process Customer Refund"]

**Primary Actor(s)**: [Who initiates this use case]
Example: Customer Service Representative

**Secondary Actor(s)**: [Who else participates]
Example: Payment Gateway (Stripe), Customer

**System Actor**: [Relevant external systems]
Example: Accounting System, Email Service

---

## Preconditions (What must be true before this starts)

1. Customer has an active account in the system
2. Customer has a recent transaction to refund (within 90 days)
3. Customer Service Rep has "issue refund" permission
4. Payment gateway API is available (not in maintenance)

---

## Postconditions — Success Scenario (What is true after successful completion)

1. Refund is processed and confirmed in Salesforce
2. Customer account balance is updated (+refund amount)
3. Refund confirmation email is sent to customer
4. Accounting system is updated with refund record
5. Customer satisfaction is recorded in CRM

---

## Postconditions — Failure Scenario (What is true if the use case fails)

1. Refund is NOT processed
2. No customer data is modified
3. Error is logged to incident tracking system
4. Customer Service Rep sees specific error message with troubleshooting steps
5. Escalation ticket is created if error is due to payment gateway issue

---

## Trigger

[What initiates this use case]

Example: "Customer calls support requesting refund. Customer Service Rep enters
refund amount and clicks 'Process Refund'"

---

## Main Success Scenario

[Step-by-step successful flow]

| Step | Actor | Action |
|------|-------|--------|
| 1 | Customer Service Rep | Opens customer account in Salesforce |
| 2 | Customer Service Rep | Clicks "Issue Refund" button on transaction record |
| 3 | System | Displays refund dialog: "Refund amount: $150.00. Reason: [dropdown]" |
| 4 | Customer Service Rep | Selects reason "Requested by customer" and clicks "Confirm" |
| 5 | System | Calls Stripe API to process refund |
| 6 | Stripe API | Returns success: refund_id=re_1234567890, status=succeeded |
| 7 | System | Updates Salesforce transaction record with refund details |
| 8 | System | Sends confirmation email to customer: "Your $150 refund has been processed" |
| 9 | System | Displays success message to Rep: "Refund completed successfully" |
| 10 | Customer Service Rep | Marks ticket as resolved |

---

## Alternative Flows

[Deviations from main success scenario]

**Alternative 2a: Refund amount exceeds transaction amount**

- 2a.1 Rep enters refund amount $200 (transaction was $150)
- 2a.2 System displays error: "Refund amount exceeds original transaction. Enter
  amount ≤ $150"
- 2a.3 Rep corrects amount to $150
- 2a.4 Return to step 4 (Main Success Scenario)

**Alternative 4a: Transaction is older than 90 days**

- 4a.1 System detects transaction date is 120 days ago
- 4a.2 System displays warning: "Refund not available. Transaction exceeds
  90-day refund window. Contact management for exception approval."
- 4a.3 Rep closes dialog; uses manual refund process

---

## Exception Flows

[System failure or error scenarios]

**Exception 1a: Stripe API returns error (rate limit)**

- 1a.1 Rep clicks "Confirm" refund
- 1a.2 System calls Stripe; Stripe returns HTTP 429 (rate limit exceeded)
- 1a.3 System displays error: "Payment gateway temporarily unavailable. Refund
  queued for retry. You will be notified when complete."
- 1a.4 System logs incident: error_id=stripe_rate_limit_001, timestamp=2024-01-15T14:30:00Z, transaction_id=ch_abc123, retry_count=0
- 1a.5 System enqueues async job to retry refund after 5 minutes
- 1a.6 Rep is notified via email when retry completes (success or failure)

**Exception 3a: Payment gateway is down (no connectivity)**

- 3a.1 Rep clicks "Confirm" refund
- 3a.2 System attempts Stripe API call; times out after 10 seconds
- 3a.3 System displays error: "Payment gateway is currently unavailable. Your
  refund request has been saved and will be processed automatically when service
  is restored."
- 3a.4 System logs critical incident and pages on-call payment engineer
- 3a.5 Incident ticket is created in JIRA; escalated to VP Engineering
- 3a.6 Refund is queued locally; retry attempted every 2 minutes for 4 hours

**Exception 5a: Stripe refund succeeds, but Salesforce update fails**

- 5a.1 Stripe refund completed successfully (refund_id=re_987654)
- 5a.2 System attempts to update Salesforce record; API call fails with 500 error
- 5a.3 System logs critical incident: "Partial success: Stripe refund processed
  but Salesforce not updated"
- 5a.4 System displays error to Rep: "Refund was processed but system update
  failed. A recovery task has been created. Notifying admin team."
- 5a.5 Manual recovery job is queued; admin team manually syncs Salesforce
- 5a.6 Rep receives notification when resolved (within 2 hours)

---

## Business Rules

[Constraints and policies governing the use case]

| Rule ID | Rule | Consequence |
|---------|------|-------------|
| BR-REF-001 | Refund only available within 90 days of transaction | Older transactions require manual exception approval |
| BR-REF-002 | Refund amount cannot exceed original transaction amount | System blocks refunds exceeding 100% |
| BR-REF-003 | Only CS Reps with role "Senior" can refund >$500 | Lesser-privileged reps see refund blocked; escalation workflow triggered |
| BR-REF-004 | Customer can request ONE refund per transaction | Second refund request denied; escalated to manager |
| BR-REF-005 | Refunds are synced to accounting system within 15 minutes | Manual reconciliation required if sync exceeds 15 min SLA |

---

## Frequency

[How often does this use case occur]

Example: "~120 refund requests per day (based on historical data). Peak hours:
11 AM–1 PM EST"

---

## Priority

**Must** — Non-negotiable. Customers expect refunds. Missing this feature causes
churn.

---

## Related Use Cases

- UC-PAY-001 (Process Payment) — often precedes this use case
- UC-CUS-002 (Create Support Ticket) — often follows this use case
- UC-ACCT-001 (Sync to Accounting) — called by this use case

---

## Notes for Implementation

- Refund logic must be idempotent (safe to retry without double-refunding)
- Stripe webhook must confirm refund_succeeded before updating Salesforce
- All refund activities must be logged for audit trail (GDPR, PCI-DSS)
- Customer notification email must NOT reveal internal transaction IDs
- Consider refund limits to prevent abuse (e.g., max 3 refunds per customer
  per month)
