# Quality Principles & Standards

Every requirement you produce MUST satisfy ALL 7 of these qualities. Treat this as a
mandatory checklist — do not deliver any document without verifying each requirement
against all 7.

## 1. Unambiguous

Each requirement has exactly **one possible interpretation**. Every stakeholder reading
the same requirement should reach the same conclusion about what the system must do.

### Banned Words (NEVER use in requirements)

These words are vague and must be replaced with specific, measurable statements:

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

### Examples of Replacements

| Banned | Specific |
|--------|----------|
| "The system should be fast" | "API response time shall be under 500ms at p95 under normal load" |
| "Users should find it easy to sign up" | "New user registration flow shall be completable in under 2 minutes with no more than 3 form submissions" |
| "The system should handle various payment methods" | "The system shall accept Visa, Mastercard, American Express, Apple Pay, and Google Pay" |
| "Appropriate error messages" | "Error messages shall state the specific field that failed validation and provide a corrective action (e.g., 'Email format invalid. Use format: user@domain.com')" |
| "Should generally handle errors gracefully" | "When payment processing fails, the system shall display the error message from the processor, log the transaction ID and error code, queue for retry after 5 minutes, and notify operations if retry count exceeds 3" |

---

## 2. Testable

Every requirement can be verified through a **specific pass/fail test**, inspection, or
demonstration. If you cannot write a concrete test case for a requirement, rewrite it
until you can.

### Testability Test

For each requirement, ask: **"Can I write a test that either passes or fails?"**

- ✅ TESTABLE: "The login button shall be located in the top-right corner of the
  navigation bar" → Test: Screenshot the nav bar, measure button position in pixels
- ✅ TESTABLE: "Session tokens shall expire after 30 minutes of inactivity" → Test:
  Create session, wait 30 min, attempt API call, verify 401 response
- ❌ UNTESTABLE: "The interface should be intuitive" → Rewrite as: "First-time users
  shall complete the checkout flow on their first attempt at least 80% of the time"

---

## 3. Complete

All **edge cases, error states, boundary conditions, and failure scenarios** are
explicitly addressed. No requirement relies on implicit knowledge.

### Completeness Questions

For every requirement, ask:

- What if input is null or empty?
- What if the network is down?
- What if the user cancels mid-operation?
- What if there's a timeout?
- What if disk is full or storage limit is hit?
- What if data is malformed?
- What if concurrent users access the same resource?
- What if an external API is unavailable?
- What if the user has no permissions?
- What if the session expires during an operation?

---

## 4. Consistent

**Zero contradictions** between requirements. Cross-reference related requirements
using their unique IDs.

### Consistency Check

Compare every requirement against all others:

- Do any two requirements contradict each other?
- Do any two requirements conflict in timing, resource usage, or scope?
- Are passwords required to be "8+ characters" in one place and "12+ characters"
  in another?

---

## 5. Traceable

Each requirement has a **unique hierarchical ID** and can be linked:

- **Upstream** -- to its source (business need, regulation, user research, strategic
  goal)
- **Downstream** -- to design decisions, architecture, test cases, user stories

### ID Hierarchy Example

```
FR-AUTH-001    ← Functional Requirement, Authentication category, number 001
NFR-PERF-001   ← Non-functional Requirement, Performance, number 001
DR-001         ← Data Requirement, number 001
IR-API-001     ← Interface Requirement, API category, number 001
```

### Traceability Matrix

Document relationships:

```
| Requirement ID | Business Objective | Test Case | Implementation Sprint |
|----------------|-------------------|-----------|----------------------|
| FR-AUTH-001    | Secure Access      | TC-AUTH-001 | Sprint 1            |
| NFR-SEC-001    | Regulatory Compliance | TC-SEC-001 | Sprint 1             |
```

---

## 6. Prioritized

Every requirement is tagged with **MoSCoW priority**:

### MoSCoW Categories

| Priority | Definition | Action |
|----------|-----------|--------|
| **Must** | Non-negotiable for launch. System is unusable without it. | Implement in this release. Block launch if missing. |
| **Should** | Important but system is viable without it. High business value. | Schedule for this release if possible. Can defer if time/resources constrained. |
| **Could** | Desirable if time/budget allows. Nice-to-have. | Include only if no Must/Should items remain. |
| **Won't** | Explicitly out of scope for this release. May revisit in future. | Do not implement. Document decision to defer. |

### Example Usage

```
FR-SEARCH-001: The system shall support full-text search across all document titles.
Priority: Must
Rationale: Core feature required for launch. User research confirms 87% of users
perform searches daily.

FR-SEARCH-002: The system shall provide search facets (filter by date, author,
category).
Priority: Should
Rationale: Enhances discoverability. Can defer if search performance suffers.

FR-SEARCH-003: The system shall learn and suggest search terms based on user behavior.
Priority: Could
Rationale: Nice-to-have AI feature. Implement only after core search is complete.

FR-SEARCH-004: The system shall support semantic search (searches by meaning, not
just keywords).
Priority: Won't
Rationale: Out of scope for v1. Requires ML infrastructure not available in MVP.
Revisit in v2.
```

---

## 7. Feasible

Requirements are **technically achievable** within known constraints:

- Technology stack and capabilities
- Budget and resource availability
- Timeline and delivery schedule
- Team skills and expertise

### Feasibility Review

For each requirement, ask:

- Can we build this with our chosen technology stack?
- Do we have the budget and timeline?
- Does our team have the required skills, or can they learn/hire?
- Are there external dependencies that might block us?
- What is the risk if this is technically infeasible?

---

## Priority Distribution Best Practice

For a healthy, shippable product:

- **Must**: 40-50% of requirements (non-negotiable)
- **Should**: 30-40% of requirements (important, but deferrable)
- **Could**: 10-20% of requirements (nice-to-have)
- **Won't**: 5-10% of requirements (explicitly out of scope, for future)

This ratio ensures you can ship with core functionality intact while maintaining
negotiation flexibility.
