# Validation Checklist & Mandatory Coverage

Before delivering ANY requirements document, run this complete validation checklist.
Do NOT ship until all 12 items are addressed.

## Complete Validation Checklist

### [ ] 1. Ambiguity Scan

Search the entire document for banned words. For EVERY instance found:
1. Quote the offending phrase
2. Replace it with a specific, measurable statement
3. Cross-check the replacement against the 7 Quality Principles

**Banned words to search for:**

- should generally
- as appropriate
- etc.
- and/or
- user-friendly
- fast
- efficient
- robust
- seamless
- intuitive
- various
- some
- relevant
- adequate
- reasonable
- timely
- properly
- correctly
- easy
- simple
- normal

**Before shipping**: Do a final find-and-replace for each word. ZERO instances
should remain.

### [ ] 2. Testability Check

For **every requirement**, mentally write a concrete test case.

**For each requirement, ask:**
- Can I write a test that definitively passes OR fails?
- Is the acceptance criteria specific enough to code a test?
- Can a QA person verify this without asking "What does that mean?"

**If the answer is NO, rewrite the requirement until it's testable.**

Examples of untestable requirements and rewrites:

| Untestable | Testable |
|-----------|----------|
| "The system should be fast" | "API response time shall be under 500ms at p95" |
| "Errors should be handled gracefully" | "When payment fails, display error message from processor with transaction ID and retry button" |
| "Users should find it intuitive" | "First-time users complete 3-step checkout process on first attempt in 80%+ of cases" |

### [ ] 3. Completeness Check

For each requirement, verify these edge cases and error scenarios are addressed:

**Null / Empty Input**
- [ ] What if input is null?
- [ ] What if input is empty string?
- [ ] What if input is zero?
- [ ] What if input is whitespace only?

**Network & Connectivity**
- [ ] What if network goes down mid-operation?
- [ ] What if connection is slow (100ms latency)?
- [ ] What if user is offline?
- [ ] What if external API is unavailable?

**Timing & Performance**
- [ ] What if operation times out?
- [ ] What if API call takes 30 seconds?
- [ ] What if user cancels mid-operation?

**Storage & Resources**
- [ ] What if disk is full?
- [ ] What if storage limit is hit?
- [ ] What if database connection pool is exhausted?
- [ ] What if memory usage spikes?

**Data Quality**
- [ ] What if data is malformed?
- [ ] What if data contains invalid characters (SQL injection attempt, XSS payload)?
- [ ] What if data is duplicate?

**Concurrency & Race Conditions**
- [ ] What if two users access the same resource simultaneously?
- [ ] What if user clicks button twice rapidly?
- [ ] What if the same operation is requested twice?

**Permissions & Access Control**
- [ ] What if user has no permissions?
- [ ] What if user's role changes mid-session?
- [ ] What if user account is deactivated?

**State & Session**
- [ ] What if session expires during operation?
- [ ] What if user is logged out?
- [ ] What if user's session token is revoked?

**External Dependencies**
- [ ] What if third-party API is down?
- [ ] What if third-party API returns unexpected response?
- [ ] What if third-party service is rate-limiting?

### [ ] 4. Contradiction Check

Compare ALL requirements against each other:

- [ ] Do any two requirements contradict each other?
- [ ] Do any two requirements conflict in timing?
- [ ] Do any two requirements conflict in resource usage?
- [ ] Are conflicting passwords requirements (8 chars vs 12 char)?
- [ ] Are conflicting uptime targets (99.9% vs 99.99%)?
- [ ] Are conflicting retention policies?

Create a contradiction matrix if you have >50 requirements:

```
| Req A | Req B | Conflict? | Resolution |
|-------|-------|-----------|------------|
| FR-AUTH-007 (min 8 char password) | FR-AUTH-012 (min 12 char password) | YES | Keep 12 char as Must; 8 char as legacy; plan deprecation |
```

### [ ] 5. Interface Completeness Check

For every external interface (UI, API, hardware, etc.):

**For User Interfaces:**
- [ ] Every input field has: type, format, required/optional, default, max length,
      validation rules
- [ ] Every error state is specified: exact error message, color, placement,
      animation
- [ ] Every button has: exact label text, enabled/disabled state, tooltip
- [ ] Responsive design specified for all screen sizes (mobile, tablet, desktop)
- [ ] Dark mode (if supported) is specified

**For APIs:**
- [ ] Every endpoint has: HTTP method, path, request schema, response schema
- [ ] Error responses specified with exact HTTP status codes and error body format
- [ ] Rate limiting specified
- [ ] Authentication method specified
- [ ] Pagination specified (if applicable)
- [ ] Versioning strategy specified

**For Hardware:**
- [ ] Connections specified (USB, Bluetooth, WiFi, etc.)
- [ ] Protocols specified
- [ ] Data format specified

**For Third-Party Integrations:**
- [ ] Service name and version specified
- [ ] Integration method specified (API, SDK, webhook, webhook receiver)
- [ ] SLA and fallback behavior specified

### [ ] 6. Non-Functional Requirements Check

**Have ALL of these NFR categories been addressed?** (Not just some — ALL)

- [ ] **Performance**: Response times, throughput, query latency with specific
      numbers
- [ ] **Scalability**: Concurrent users, data volume, growth rate
- [ ] **Security**: Authentication, authorization, encryption, audit logging,
      CSRF/XSS protection
- [ ] **Reliability**: Uptime target, MTTR, MTBF, failover, disaster recovery
- [ ] **Accessibility**: WCAG level, keyboard navigation, screen reader, color
      contrast
- [ ] **Usability**: Learnability, error recovery, user satisfaction benchmarks
- [ ] **Maintainability**: Logging, monitoring, deployment, code quality
- [ ] **Portability**: Browsers, operating systems, devices, offline support
- [ ] **Compliance**: GDPR, HIPAA, PCI-DSS, SOX, ADA, COPPA, CCPA, industry
      regulations
- [ ] **Internationalization**: Languages, locales, date/time/currency formats,
      RTL support

If ANY category has 0 requirements, ask yourself: "Is this actually not applicable,
or did we miss it?" If it's legitimately not applicable, document that decision
explicitly: "Internationalization: Not applicable for v1 (single-language, single-market MVP). Revisit in v2."

### [ ] 7. Priority Distribution Check

Does the requirement set have a healthy priority distribution?

- [ ] **Must**: 40-50% (non-negotiable, ship with these)
- [ ] **Should**: 30-40% (important, but deferrable if necessary)
- [ ] **Could**: 10-20% (nice-to-have)
- [ ] **Won't**: 5-10% (explicitly out of scope, for future)

Count totals:

```
Must:   n requirements (x%)
Should: n requirements (x%)
Could:  n requirements (x%)
Won't:  n requirements (x%)
TOTAL:  n requirements
```

If one category dominates (>70% Must, or <10% Should), rebalance. This indicates
either:
- Scope creep (too much Must, not enough deferred)
- Underspecification (too many Could, not enough firm commitments)

### [ ] 8. Glossary & Term Definition Check

- [ ] Are ALL domain-specific terms defined?
- [ ] Does every term have a clear, business-friendly explanation?
- [ ] Are there any acronyms or abbreviations WITHOUT definitions?
- [ ] Is the glossary organized alphabetically?

Example glossary entry:

```
Bcrypt: A cryptographic hashing function specifically designed for passwords.
Unlike general-purpose hash functions (SHA-256), bcrypt is intentionally slow to
resist brute-force attacks. The "cost factor" parameter controls hashing speed.
Cost factor ≥12 is recommended for new systems (2024).
```

### [ ] 9. Assumptions & Risk Assessment Check

- [ ] Are ALL assumptions explicitly listed and numbered?
- [ ] For each assumption, is the risk documented?
- [ ] For each high-risk assumption, is a mitigation plan included?

Example assumptions log:

```
Assumption #1: Salesforce API will remain available with 99.9% uptime SLA
  - Risk: If Salesforce is down, our data sync fails
  - Probability: Low (Salesforce has strong uptime record)
  - Mitigation: Implement local queue + retry logic; notify users if sync fails

Assumption #2: Project team will have AWS account access
  - Risk: If access is delayed, development is blocked
  - Probability: Medium (bureaucratic delays possible)
  - Mitigation: Request access in planning phase; identify backup deployment option
```

### [ ] 10. Scope Clarity Check

- [ ] Are IN-SCOPE items explicitly listed?
- [ ] Are OUT-OF-SCOPE items explicitly listed?
- [ ] Are there any gray areas where something is ambiguous in scope?

Example scope section:

```
IN SCOPE:
- User authentication via email/password
- Password reset via email
- Session management and timeout
- Account lockout after N failed attempts
- Audit logging of authentication events

OUT OF SCOPE:
- Single sign-on (OAuth2, SAML) — future feature
- Passwordless authentication (magic links) — future feature
- Multi-factor authentication — future feature
- Biometric login (fingerprint, face) — future feature
```

### [ ] 11. Traceability Check

- [ ] Does each functional requirement trace to a business objective?
- [ ] Does each non-functional requirement trace to a business objective or
      regulation?
- [ ] Is a traceability matrix present?

Example traceability:

```
| Req ID | Business Objective | Test Case ID | Implementation Sprint |
|--------|-------------------|--------------|----------------------|
| FR-AUTH-001 | Secure Access | TC-AUTH-001 | Sprint 1 |
| NFR-SEC-001 | Regulatory Compliance | TC-SEC-001 | Sprint 1 |
| NFR-PERF-001 | User Satisfaction | TC-PERF-001 | Sprint 2 |
```

### [ ] 12. Open Questions Log Check

- [ ] Is there an "Open Questions" section?
- [ ] Does each open question have: ID, question text, owner, target resolution
      date, status?
- [ ] Are answers tracked as decisions are made?
- [ ] Are there any unresolved blockers?

Example open questions log:

```
| ID | Question | Owner | Target Date | Status | Decision |
|----|----------|-------|-------------|--------|----------|
| Q-001 | Should we support passwordless login in v1? | Product Manager | 2024-02-15 | Pending | TBD |
| Q-002 | What's the acceptable password reset email latency? | Eng Lead | 2024-02-10 | Resolved | 30 seconds max (SLA) |
| Q-003 | Do we need SMS as alternative to email for password reset? | Product Manager | 2024-02-20 | Pending | TBD |
```

---

## Mandatory Coverage Areas

### A. Functional Requirements (FR)

Address ALL of these categories:

- [ ] **Core Features**: Primary functionality the system delivers
  - Example: User authentication, contact management, payment processing

- [ ] **Business Rules & Validation**: Rules governing how data is processed
  - Example: "Refund only available within 90 days of transaction"
  - Example: "Only users with 'Admin' role can delete contacts"

- [ ] **Data Validation**: For EVERY input field
  - Example: Email must be valid RFC 5322 format
  - Example: Phone number must be 10 digits
  - Example: Age must be 18–120

- [ ] **Error Handling**: For EVERY operation that can fail
  - Example: "When payment fails, display processor error message + retry button"
  - Example: "When API times out, queue locally + retry every 5 minutes"

- [ ] **State Transitions**: For features with complex lifecycles
  - Example: Order states: pending → paid → shipped → delivered → returned
  - Example: Deal states: lead → qualified → proposal → negotiation → closed

- [ ] **Batch Processing & Scheduled Operations**: If applicable
  - Example: "Nightly backup at 2 AM UTC"
  - Example: "Monthly invoice generation on 1st of month"
  - Example: "Archive data older than 90 days to cold storage"

- [ ] **Notifications & Alerts**: When does system notify users/admins?
  - Example: "Send confirmation email within 30 seconds of signup"
  - Example: "Alert operations team if error rate exceeds 2%"

### B. Non-Functional Requirements (NFR)

**CRITICAL: Address ALL 10 categories, not just performance and security.**

#### B.1 Performance

Specify with exact numbers and measurement conditions:

- Response time (p50, p95, p99 latency)
  - Example: "API response time ≤ 500ms at p95 under normal load (100 concurrent users)"
- Throughput (requests/second, transactions/second)
  - Example: "Support 1,000 concurrent user sessions"
- Page load time (using Lighthouse metrics: LCP, FCP, TTFB)
  - Example: "Largest Contentful Paint ≤ 2.5 seconds on 4G mobile"
- Query latency (database queries, search)
  - Example: "Product search results return in ≤ 500ms for queries up to 10,000 products"

#### B.2 Scalability

- Maximum concurrent users
  - Example: "Support 10,000 concurrent users with load balancing"
- Maximum data volume
  - Example: "Support datasets up to 1TB"
- Growth rate assumptions
  - Example: "Expect 1000 new users/month; 100GB new data/month"
- Horizontal vs. vertical scaling expectations
  - Example: "System must scale horizontally (add more servers) not vertically"

#### B.3 Security

**CRITICAL: Do NOT skip any of these.**

- Authentication method and mechanism
  - Example: "Email/password with bcrypt cost factor ≥12"
  - Example: "OAuth2 via Microsoft Entra ID"
- Authorization model (RBAC, ABAC, or other)
  - Example: "Role-Based Access Control: Admin, Manager, User, Guest"
  - Example: "Attribute-Based: users can only access data matching their
    department"
- Encryption (at rest, in transit)
  - Example: "All data at rest encrypted with AES-256"
  - Example: "All data in transit over TLS 1.2+"
- Audit logging
  - Example: "Log all authentication events, data modifications, admin actions
    with timestamp, user ID, IP, action type, result"
- Session management
  - Example: "Sessions expire after 30 minutes of inactivity; HttpOnly Secure
    cookies"
- CSRF, XSS, SQL injection protection
  - Example: "CSRF tokens on all state-changing forms"
  - Example: "Parameterized queries for all database access"
- Secret management
  - Example: "API keys stored in AWS Secrets Manager, not in code"
  - Example: "Passwords hashed with bcrypt, never logged"
- Vulnerability scanning
  - Example: "Weekly automated security scanning; no high-severity vulnerabilities
    in dependencies"

#### B.4 Reliability & Availability

- Uptime target (SLA)
  - Example: "99.9% uptime SLA (43.2 min downtime/month)"
- MTTR (Mean Time To Recover)
  - Example: "Recovery time from failure ≤ 4 hours"
- MTBF (Mean Time Between Failures)
  - Example: "No unplanned downtime more than once per quarter"
- Failover strategy
  - Example: "Database replication across 3 availability zones; automatic failover
    <30 seconds"
- Disaster recovery (RPO/RTO)
  - Example: "RPO (Recovery Point Objective): ≤24 hours; RTO (Recovery Time
    Objective): ≤4 hours"
- Graceful degradation
  - Example: "If payment gateway is down, queue locally; show message 'Payment
    processing delayed'"

#### B.5 Accessibility

- WCAG compliance level (2.1 A, 2.1 AA, 2.1 AAA)
  - Example: "All public-facing features must meet WCAG 2.1 Level AA minimum"
- Keyboard navigation
  - Example: "All interactive elements reachable via Tab key; navigable without mouse"
- Screen reader compatibility
  - Example: "Tested with NVDA and JAWS; all content semantically correct"
- Color contrast ratio
  - Example: "4.5:1 for normal text; 3:1 for large text"
- Alt text and captions
  - Example: "All images have descriptive alt text; all videos have captions"
- Focus management
  - Example: "Visible focus indicator on all interactive elements; focus order
    logical"

#### B.6 Usability

- Learnability target
  - Example: "First-time users complete checkout in under 2 minutes"
- Error recovery
  - Example: "Users can undo/redo actions; clear error messages with solutions"
- User satisfaction benchmark
  - Example: "System Usability Scale score ≥8.0/10 within 6 weeks of launch"

#### B.7 Maintainability

- Logging standards
  - Example: "All events logged with level (INFO, WARN, ERROR), timestamp, user
    ID, request ID"
- Monitoring & alerting
  - Example: "Dashboards for error rate, latency, database connections; alerts
    for error rate >2%"
- Deployment strategy
  - Example: "Blue-green deployment; rollback capability within 5 minutes"
- Configuration management
  - Example: "All config in environment variables; no hardcoded values"
- Code quality gates
  - Example: "80%+ unit test coverage; no technical debt in critical paths"

#### B.8 Portability

- Supported browsers + versions
  - Example: "Chrome 90+, Safari 14+, Firefox 88+, Edge 90+"
- Operating systems
  - Example: "Windows 10+, macOS 10.15+, iOS 14+, Android 10+"
- Devices and screen sizes
  - Example: "iPhone SE (375px) to 4K (3840px); tablets and desktops"
- Offline capabilities
  - Example: "Mobile app caches data; can view offline; syncs when connection
    restored"

#### B.9 Compliance

List ALL applicable regulations and standards:

- GDPR (General Data Protection Regulation)
  - Example: "User can request data export in machine-readable format within 30 days"
  - Example: "Personal data deleted within 14 days of deletion request"
- HIPAA (Health Insurance Portability and Accountability Act)
  - Example: "PHI encrypted at rest and in transit; audit logging of all access"
- PCI-DSS (Payment Card Industry Data Security Standard)
  - Example: "Credit card data never stored; tokenized via Stripe"
- SOX (Sarbanes-Oxley Act)
  - Example: "Financial data auditable; immutable audit logs"
- ADA (Americans with Disabilities Act)
  - Example: "Must meet WCAG 2.1 AA accessibility standards"
- COPPA (Children's Online Privacy Protection Act)
  - Example: "If users <13, parental consent required for account creation"
- CCPA (California Consumer Privacy Act)
  - Example: "California users can request/delete personal data"
- Industry-specific regulations
  - Example: "If financial: SEC regulations for data handling"
  - Example: "If e-commerce in EU: Brussels regulations for returns"

#### B.10 Internationalization (I18N)

- Languages supported
  - Example: "English (US, UK), Spanish (Spain, Mexico), French (Canada)"
- Date/time/currency/number formatting
  - Example: "Date: MM/DD/YYYY in en-US, DD/MM/YYYY in en-GB"
  - Example: "Currency: $USD in en-US, €EUR in es-ES"
  - Example: "Numbers: 1,000.50 in en-US, 1.000,50 in de-DE"
- Right-to-left (RTL) language support
  - Example: "Arabic and Hebrew UI mirrored; text right-aligned"
- Unicode and character encoding
  - Example: "All text UTF-8 encoded; support for emoji, CJK characters"

### C. Interface Requirements (IR)

Address ALL of these:

#### C.1 User Interfaces (UI)

For each screen/page:

- [ ] Field specifications:
  - Input type (text, number, date, select, file, etc.)
  - Format (e.g., RFC 5322 for email)
  - Required vs. optional
  - Default value
  - Min/max length
  - Validation rules
  - Error state and message

- [ ] Button/interaction specifications:
  - Label text (exact)
  - Enabled/disabled state
  - On-click behavior
  - Loading state (if async)
  - Disabled reason (if applicable)

- [ ] Layout & responsive design:
  - Mobile layout (≤480px)
  - Tablet layout (481–768px)
  - Desktop layout (≥769px)
  - Stacking behavior

- [ ] Error states:
  - Exact error message text
  - Color/styling
  - Placement
  - Duration (auto-dismiss or persistent?)

- [ ] Accessibility:
  - WCAG 2.1 AA compliance
  - Keyboard navigation order
  - aria-labels, aria-live announcements
  - Focus management

#### C.2 Software Interfaces (APIs)

For each endpoint:

- [ ] HTTP method (GET, POST, PUT, PATCH, DELETE)
- [ ] Endpoint path (e.g., `/api/v1/users/{id}`)
- [ ] Request schema (all fields, types, required/optional)
- [ ] Response schema (success and error cases)
- [ ] HTTP status codes (200, 201, 400, 401, 404, 500, etc.)
- [ ] Authentication method (Bearer token, API key, etc.)
- [ ] Rate limiting (requests/minute per user/IP)
- [ ] Pagination (limit, offset/cursor)
- [ ] Versioning strategy (URL path, header, query param)

#### C.3 Hardware Interfaces

If applicable:

- [ ] Connection type (USB, Bluetooth, WiFi, serial)
- [ ] Protocol specification
- [ ] Data format
- [ ] Connector specs

#### C.4 Third-Party Integrations

For each integration:

- [ ] Service name and documentation URL
- [ ] Integration method (REST API, SDK, webhook, etc.)
- [ ] SLA and uptime guarantee
- [ ] Fallback behavior if service is unavailable
- [ ] Data sync frequency and mechanism
- [ ] Error handling and retry logic

### D. Data Requirements (DR)

Address ALL of these:

- [ ] **Logical Data Model**: Entity-relationship diagram or description
  - Example: User table with email, password, created_at, updated_at
  - Example: Order table with user_id, total_amount, status, created_at

- [ ] **Data Dictionary**: For each table, describe all fields
  - Field name, type (VARCHAR, INT, TIMESTAMP, etc.), nullable, constraints

- [ ] **Data Retention & Archival Policy**:
  - How long is data retained in hot storage?
  - How long is data retained in cold storage?
  - When is data deleted?
  - Example: "Logs retained 30 days; archived to S3 Glacier for 2 years; then
    deleted"

- [ ] **Data Migration Strategy** (if migrating from legacy system):
  - Source system and target system identified
  - Validation rules for data quality
  - Rollback plan if migration fails
  - Example: "Migrate 50,000+ user contacts with 99.9% accuracy; validate via
    checksum comparison"

- [ ] **Data Backup & Recovery Procedures**:
  - Backup frequency (daily, hourly, etc.)
  - Backup retention period
  - Recovery testing frequency (monthly, quarterly)
  - RPO and RTO targets

- [ ] **Data Privacy Classification**:
  - Which fields contain PII (Personally Identifiable Information)?
  - Which fields contain PHI (Protected Health Information)?
  - Which fields contain financial data?
  - Which fields are public?
  - Example: email=PII, credit_card=financial, phone=PII, name=PII

- [ ] **Data Quality Rules**:
  - Uniqueness constraints (email must be unique)
  - Referential integrity (user_id must exist in users table)
  - Format validation (email format, phone format)
  - Business rules (age ≥18, order_total ≥0)
