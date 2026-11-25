# Requirement Writing Rules & Conventions

## Language Rules

### 1. Use Consistent Auxiliary Verbs

Every requirement uses one of these three modal verbs:

- **"shall"** — Mandatory requirement. The system MUST do this.
  - Example: "The system **shall** support login via email and password"
  - No negotiation. Requirement is firm.

- **"should"** — Recommended requirement. The system ideally should do this, but
  the system is viable without it.
  - Example: "The system **should** remember the user's login for 30 days"
  - Can be deferred or negotiated.

- **"may"** — Optional requirement. The system is allowed to do this, but not
  required.
  - Example: "The system **may** show AI-recommended related items"
  - Nice-to-have. Lower priority.

**NEVER use:**
- "could"
- "might"
- "probably"
- "would"
- "is expected to"
- "must" (use "shall" instead)

### 2. Use Active Voice

**Correct** (active): "The system shall validate the email format before accepting it"

**Incorrect** (passive): "The email format shall be validated before being accepted"

Active voice is clearer about WHO is doing the action.

### 3. One Requirement Per Statement

**WRONG**: "The system shall authenticate users and log all authentication events
and send a confirmation email."

**CORRECT**:
- FR-AUTH-001: "The system shall authenticate users using email and password."
- FR-AUDIT-001: "The system shall log all authentication events (login, logout,
  password reset)."
- FR-NOTIFY-001: "The system shall send a confirmation email upon successful
  login."

Each requirement is independent and testable.

### 4. Specify Exact Quantities (Never Vague)

| Vague | Specific |
|-------|----------|
| "quickly" | "within 500ms at p95 latency" |
| "user-friendly" | "first-time users complete checkout in <2 minutes" |
| "efficiently" | "handle 10,000 concurrent users with <1% error rate" |
| "several" | "at least 3, no more than 5" |
| "relevant" | "related products in the same category" |
| "large" | ">1 MB file size" |
| "fast" | "page load time LCP <2.5 seconds" |
| "robust" | "system remains operational with 99.9% uptime; gracefully degrade when database is unavailable" |

### 5. Use Specific Terms, Define Everything

Don't assume the reader knows your domain.

**WRONG**: "The system shall support multi-tenant architecture with proper
isolation."

**CORRECT**: "The system shall isolate data by customer account such that no
query or operation from User A can return data belonging to User B, even if User A
has administrative permissions."

Define ambiguous terms in a glossary:
- "Multi-tenant": Multiple customers sharing the same system instance with
  isolated data
- "Proper isolation": No cross-customer data leakage under any conditions
- "Administrative permissions": Account-level access to all features and user
  management

---

## Input Specification Rules

### For Every INPUT: Specify

1. **Type**: Text, number, date, file, selection, etc.
2. **Format**: RFC 5322 for email, ISO 8601 for date, UUID for ID, etc.
3. **Valid range**: Min/max values, allowed enum values
4. **Required vs. optional**: Must provide? Or can omit?
5. **Default value**: What if user doesn't provide?
6. **Max length**: Character limit
7. **Validation rules**: What makes input invalid?

### Example:

**LOGIN PAGE FORM**

Field: Email
- Type: Text input
- Format: RFC 5322 (user@domain.com)
- Valid range: 1–254 characters
- Required: Yes
- Default: Empty string
- Max length: 254 characters
- Validation: Format must match RFC 5322; domain must exist (DNS lookup)
- Invalid examples: "user", "user@", "@domain.com", "user@domain"
- Valid examples: "user@example.com", "john.doe+test@sub.domain.co.uk"

Field: Password
- Type: Password input (masked)
- Format: Any UTF-8 characters
- Valid range: 8–128 characters
- Required: Yes
- Default: Not applicable (user must enter)
- Min length: 8 characters
- Max length: 128 characters
- Validation: Minimum 8 characters; no server-side format/complexity validation
  on login (only on password creation)
- Note: Do NOT show complexity requirements on login form (only on signup)

---

## Output Specification Rules

### For Every OUTPUT: Specify

1. **Format**: JSON, HTML, CSV, PDF, etc.
2. **Destination**: Browser, email, file, API response, database log
3. **Timing**: Immediate (synchronous), after X seconds, batch nightly
4. **Schema**: Field names, types, presence (required/optional)
5. **Error format**: What does an error response look like?

### Example:

**LOGIN API RESPONSE**

Successful response (HTTP 200):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "firstName": "John"
  }
}
```

Failed authentication (HTTP 401):
```json
{
  "error": "Invalid email or password",
  "errorCode": "AUTH_INVALID_CREDENTIALS"
}
```

Account locked (HTTP 403):
```json
{
  "error": "Account temporarily locked due to 5 failed login attempts. Try again in 15 minutes.",
  "errorCode": "AUTH_ACCOUNT_LOCKED",
  "retryAfterSeconds": 900
}
```

Server error (HTTP 500):
```json
{
  "error": "Internal server error. Please try again later.",
  "errorCode": "INTERNAL_ERROR",
  "requestId": "req_abc123def456"
}
```

Timing: Response delivered within 500ms at p95 latency under normal load (100
concurrent logins).

---

## Operation Specification Rules

### For Every OPERATION: Specify

1. **What happens on success**: State changed? Data committed? Confirmation sent?
2. **What happens on failure**: Partial failure? Rollback? Retry?
3. **Timeout behavior**: How long do we wait? What if it takes too long?
4. **Invalid data handling**: What if the input violates business rules?
5. **Concurrent access**: What if two users do the same operation simultaneously?
6. **Cancellation**: Can the user cancel mid-operation? What's the state after?
7. **Idempotency**: Is it safe to retry the same operation without duplicating?

### Example:

**PAYMENT PROCESSING OPERATION**

**Success scenario** (HTTP 200):
- Charge is deducted from customer's card
- Order record is created with status=`paid`
- Inventory is decremented
- Confirmation email is sent to customer within 30 seconds
- Customer sees "Payment successful. Order #12345 confirmed."

**Insufficient funds failure** (HTTP 400):
- No charge is deducted
- No order created
- Customer sees "Payment failed: Insufficient funds. Check your card."
- Retry is allowed immediately (no rate limit)

**Declined card failure** (HTTP 400):
- No charge is deducted
- No order created
- Customer sees "Payment failed: Card was declined. Try another card."
- Retry is allowed after 10 seconds

**Network timeout** (HTTP 504):
- Charge status is UNKNOWN (Stripe may or may not have charged)
- System displays: "Payment processing is taking longer than expected. Do NOT
  refresh or close. We will send you an email with status update within 2 minutes."
- Async job polls Stripe for up to 5 minutes to confirm payment status
- Customer receives email: "Payment succeeded" or "Payment failed"
- If status remains UNKNOWN after 5 minutes, escalate to manual recovery

**Rate limit exceeded** (HTTP 429):
- Customer sees: "Too many payment attempts. Try again in 1 minute."
- Queue is not filled; subsequent attempts are rejected until rate limit resets

**Payment gateway is down** (HTTP 503):
- Customer sees: "Payment processing is temporarily unavailable. Please try
  again in 1 minute."
- System queues payment locally; retries every 2 minutes for 4 hours
- If payment succeeds during retry, customer is notified via email
- If payment never succeeds after 4 hours, escalate to support team

**Idempotency**: Payment operations are idempotent using idempotency keys. If
the same customer submits the same amount for the same order twice within 60
seconds, the system returns the first payment's result instead of charging twice.

**Concurrent access**: If two users attempt to pay for the same order
simultaneously, the first payment succeeds; the second receives error "Order
already paid" (HTTP 409 Conflict).

---

## Requirement ID Format

Use **hierarchical IDs** to organize and cross-reference requirements.

### Format

`[PREFIX]-[CATEGORY]-[NUMBER]`

### Prefix

- **FR** = Functional Requirement
- **NFR** = Non-Functional Requirement (performance, security, reliability, etc.)
- **DR** = Data Requirement
- **IR** = Interface Requirement
- **BR** = Business Requirement
- **CR** = Constraint Requirement

### Category (domain-specific)

- **AUTH** = Authentication
- **PERF** = Performance
- **SEC** = Security
- **SCALE** = Scalability
- **ACC** = Accessibility
- **COMPAT** = Compatibility
- **I18N** = Internationalization
- **CONTACT** = Contact Management
- **PAYMENT** = Payment Processing
- etc.

### Number

Sequential within each category, zero-padded to 3 digits (001, 002, 003, etc.)

### Examples

```
FR-AUTH-001    Functional requirement: User authentication, requirement #1
FR-AUTH-002    Functional requirement: User authentication, requirement #2

NFR-PERF-001   Non-functional requirement: Performance, requirement #1
NFR-PERF-002   Non-functional requirement: Performance, requirement #2

NFR-SEC-001    Non-functional requirement: Security, requirement #1
NFR-SEC-002    Non-functional requirement: Security, requirement #2

DR-001         Data requirement #1 (no subcategory)

IR-API-001     Interface requirement: API, requirement #1
IR-UI-001      Interface requirement: UI, requirement #1

BR-001         Business requirement #1
```

### Cross-Reference Example

"See FR-AUTH-001 for password complexity requirements. FR-AUTH-002 builds on
FR-AUTH-001 by adding rate limiting."

---

## Required Fields Per Requirement

Every requirement in a formal document must include:

| Field | Description | Example |
|-------|-------------|---------|
| **ID** | Unique hierarchical identifier | FR-AUTH-001 |
| **Description** | Requirement statement using shall/should/may | "The system shall validate email format per RFC 5322 before accepting user input." |
| **Rationale** | Why this requirement exists (1 sentence) | "Email validation prevents invalid data in the system and improves user experience with immediate feedback." |
| **Priority** | Must / Should / Could / Won't (MoSCoW) | Must |
| **Source** | Who/what requested it (stakeholder, regulation, user research) | "Security best practice per OWASP; user research: 73% of users frustrated by invalid email errors" |
| **Acceptance Criteria** | Specific pass/fail conditions using Given/When/Then | "AC1: Given malformed email, when user submits, then system displays inline error within 100ms. AC2: Given valid email, when user submits, then form proceeds to password field." |
| **Dependencies** | IDs of related/blocking requirements | "Depends on FR-AUTH-002 (password validation) for complete authentication flow" |
| **Notes** | Edge cases, open questions, assumptions specific to this requirement | "If email provider does not accept that format, customer may need help from support. Consider adding email confirmation link as additional verification step (future enhancement)." |

### Full Example

```
ID: FR-AUTH-001

Description:
The system shall validate email format per RFC 5322 before accepting the email
address as a valid user input.

Rationale:
Email validation prevents invalid data in the system and improves user experience
with immediate feedback.

Priority: Must

Source:
- Security best practice per OWASP Top 10
- User research (73% of users frustrated by invalid email handling)
- Regulatory requirement: GDPR data quality obligations

Acceptance Criteria:
AC1: Given user enters "user@example.com" (valid), when user submits, then form
     accepts and proceeds.
AC2: Given user enters "user" (missing @), when user submits, then system displays
     inline error "Please enter a valid email address" within 100ms without full-page
     reload.
AC3: Given user enters "user@" (missing domain), when user submits, then system
     displays inline error within 100ms.
AC4: Given user enters "user@localhost" (no TLD), when user submits, then system
     displays inline error within 100ms.
AC5: Given user enters "user@example" (no TLD extension), when user submits, then
     system displays inline error within 100ms.

Dependencies:
- Related: FR-AUTH-002 (password validation)
- Related: FR-AUTH-003 (error message consistency)
- No blocking dependencies

Notes:
- Validation should be real-time on blur, not just on form submission
- The error message must NOT change the form layout (no shifting)
- Consider adding email verification link as additional step (future enhancement,
  not in v1)
- Some valid RFC 5322 emails are rejected by major email providers (e.g., quoted
  strings). Consider pragmatic approach: validate format AND check MX record.
```

---

## Informal → Structured Conversion Example

This example demonstrates how to expand a casual feature request into comprehensive
requirements.

### User says:

"I need a login page where users can sign in with email and password, and there
should be a forgot password option."

### You produce (minimum expansion: 3x the number of statements):

#### Functional Requirements

**FR-AUTH-001**: The system shall allow users to authenticate using email address
and password.
- Priority: Must
- AC: Given valid credentials, when user submits login form, then system creates
  an authenticated session and redirects to dashboard.

**FR-AUTH-002**: The system shall validate email format per RFC 5322 before form
submission.
- Priority: Must
- AC: Given malformed email, when user submits, then system displays inline error
  "Please enter a valid email address" without page reload.

**FR-AUTH-003**: The system shall display a generic error "Invalid email or
password" when authentication fails, without revealing which field was incorrect.
- Priority: Must
- Rationale: Security best practice to prevent user enumeration attacks

**FR-AUTH-004**: The system shall lock the user account after 5 consecutive
failed login attempts for a duration of 15 minutes.
- Priority: Should
- AC: Given 5 failed attempts, when user attempts 6th login, then system displays
  "Account temporarily locked. Try again in 15 minutes."

**FR-AUTH-005**: The system shall display a "Forgot Password?" link below the
password field on the login page.
- Priority: Must

**FR-AUTH-006**: The system shall send a password reset email containing a
single-use token that expires after 60 minutes.
- Priority: Must
- AC: Given valid email in system, when user requests reset, then system sends
  email within 30 seconds with unique reset link.

**FR-AUTH-007**: The system shall enforce password complexity: minimum 8
characters, at least 1 uppercase, 1 lowercase, 1 digit, 1 special character.
- Priority: Must

**FR-AUTH-008**: The system shall terminate user sessions after 30 minutes of
inactivity and require re-authentication.
- Priority: Should

**FR-AUTH-009**: The system shall log all authentication events (success, failure,
lockout, password reset) with timestamp, IP address, user agent, and user ID.
- Priority: Must

**FR-AUTH-010**: The system shall support "Remember me" functionality extending
session to 30 days, with option to revoke all sessions.
- Priority: Could

**FR-AUTH-011**: The system shall rate-limit password reset requests to 3 per
email address per hour.
- Priority: Should

#### Non-Functional Requirements

**NFR-SEC-001**: All authentication data shall be transmitted over TLS 1.2 or
higher.
- Priority: Must

**NFR-SEC-002**: Passwords shall be hashed using bcrypt with minimum cost factor
of 12. Plaintext passwords shall never be stored or logged.
- Priority: Must

**NFR-SEC-003**: The login form shall include CSRF token protection.
- Priority: Must

**NFR-SEC-004**: Session tokens shall be cryptographically random, minimum 128
bits, stored in HttpOnly Secure cookies.
- Priority: Must

**NFR-PERF-001**: The login page shall achieve Largest Contentful Paint (LCP)
under 2.0 seconds on 4G connection.
- Priority: Should

**NFR-PERF-002**: Authentication API response time shall be under 500ms at p95
under normal load.
- Priority: Should

**NFR-ACC-001**: The login form shall be fully navigable via keyboard (Tab, Enter,
Escape).
- Priority: Should

**NFR-ACC-002**: The login form shall meet WCAG 2.1 AA: 4.5:1 contrast ratio,
visible focus indicators, aria-labels on all inputs, error announcements via
aria-live.
- Priority: Should

**NFR-COMP-001**: Password reset flow shall comply with NIST SP 800-63B
guidelines.
- Priority: Should

#### Interface Requirements

**IR-LOGIN-001**: Login page shall have email and password input fields with
specific field labels, placeholders, and error states.

**IR-LOGIN-002**: Password reset email shall contain a unique token link valid
for 60 minutes, clear instructions, and customer support contact.

**IR-API-001**: POST /api/v1/auth/login endpoint with JSON request/response,
rate limiting, and error codes.

#### Data Requirements

**DR-001**: Passwords shall be hashed using bcrypt and never stored in plaintext.

**DR-002**: Password reset tokens shall be single-use and expire after 60 minutes.

**DR-003**: Login attempts and resets shall be logged with timestamp, IP, user
agent for audit and security analysis.

### Summary

**Original**: 1 casual sentence
**Expanded**: 18 comprehensive, testable requirements covering:
- Core functionality (6 functional requirements)
- Error handling (1)
- Account lockout (1)
- Session management (3)
- Security (4 non-functional)
- Performance (2)
- Accessibility (2)
- Compliance (1)
- Interfaces (3)
- Data handling (3)

Each requirement is unambiguous, testable, complete, and traceable.
