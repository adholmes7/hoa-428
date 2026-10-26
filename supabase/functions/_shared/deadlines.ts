// Request types, deadline rules and California holiday math.
// Pure TypeScript with no imports so both the web app and the edge functions can use it.
//
// Not legal advice. Each rule cites its source; items marked VERIFY need checking.

export type DayType = "business" | "calendar";
export type DeadlineKind = "statutory" | "ccr" | "followup";
export type Method =
  | "personal"
  | "first_class"
  | "certified"
  | "certified_rr"
  | "online_certified"
  | "email_consent"
  | "email_copy";

export interface RequestType {
  id: string;
  label: string;
  short: string;
  description: string;
  legalBasis: string;
  dayType: DayType | null;
  days: number | null;
  deadlineKind: DeadlineKind | null;
  ifMissed: string;
  /** Delivery rules that matter for this request type */
  deliveryNote?: string;
  /** Recommended delivery method */
  recommendedMethod: Method;
  verify?: boolean;
  /** Start the request as private to the unit (e.g. replies with other owners' personal details) */
  defaultPrivate?: boolean;
  /** Suggested tier when the site mails the letter */
  mailTier: MailTier;
  /** The governing documents require certified mail or personal delivery */
  requiresCertified?: boolean;
}

export type MailTier = "first_class" | "certified" | "certified_rr";

export const MAIL_TIERS: Record<MailTier, { label: string; price: number; summary: string; deadlines: string }> = {
  first_class: {
    label: "First-class mail",
    price: 1.16,
    summary: "Valid notice under CC&R §14.12 (delivery is complete when mailed). USPS scans show it moving, but there's no delivery confirmation.",
    deadlines: "The deadline is estimated from the last USPS scan, not a confirmed delivery date.",
  },
  certified: {
    label: "Certified Mail",
    price: 8.11,
    summary: "USPS records the exact delivery date, which starts the HOA's clock. Good for any request with a legal deadline.",
    deadlines: "The deadline is set exactly when USPS confirms delivery.",
  },
  certified_rr: {
    label: "Certified Mail + electronic return receipt",
    price: 11.02,
    summary: "Adds a copy of the signature of whoever signed for it. Strongest proof, for letters that may end up in mediation or court.",
    deadlines: "The deadline is set exactly when USPS confirms delivery.",
  },
};

export const REQUEST_TYPES: RequestType[] = [
  {
    id: "records_current",
    label: "Records request: current fiscal year",
    short: "Records (current year)",
    description:
      "Inspect or get copies of association records from the current fiscal year: invoices, contracts, bank statements, budgets, insurance policies, minutes, reserve transfers.",
    legalBasis: "Civ. Code §§5200, 5205, 5210(b)(1); CC&R §3.10",
    dayType: "business",
    days: 10,
    deadlineKind: "statutory",
    ifMissed:
      "You may sue in small claims court to enforce the right to inspect (Civ. Code §5235). The court can award a civil penalty of up to $500 per written request that was unreasonably denied, plus costs.",
    recommendedMethod: "certified_rr",
    mailTier: "certified",
  },
  {
    id: "records_prior",
    label: "Records request: previous two fiscal years",
    short: "Records (prior 2 years)",
    description: "Association records from the two fiscal years before the current one.",
    legalBasis: "Civ. Code §§5200, 5205, 5210(b)(2)",
    dayType: "calendar",
    days: 30,
    deadlineKind: "statutory",
    ifMissed: "Same remedies as a current-year request: small claims action and civil penalties (Civ. Code §5235).",
    recommendedMethod: "certified_rr",
    mailTier: "certified",
  },
  {
    id: "minutes",
    label: "Board meeting minutes",
    short: "Minutes",
    description:
      "Minutes (or draft minutes, or a summary) of open board meetings. Minutes must be available within 30 days of each meeting.",
    legalBasis: "Civ. Code §4950(a), §5210(b)(4)",
    dayType: "business",
    days: 10,
    deadlineKind: "statutory",
    ifMissed: "Treated as a records request: small claims action under Civ. Code §5235.",
    recommendedMethod: "certified_rr",
    mailTier: "certified",
  },
  {
    id: "membership_list",
    label: "Membership list (owners' names, addresses, emails)",
    short: "Membership list",
    description:
      "The list of members with names, property and mailing addresses, and email addresses, for contacting other owners about association matters. Members who opted out are left off.",
    legalBasis: "Civ. Code §§5200(a)(9), 5210(b)(6), 5220; Corp. Code §§8330, 8338",
    dayType: "business",
    days: 10,
    deadlineKind: "statutory",
    ifMissed:
      "Within 10 business days the HOA must either provide the list or offer, in writing, another way to reach your purpose (for example, mailing your message for you). If it does neither, you can sue in small claims court to enforce records rights (Civ. Code §5235) or seek a court order (Corp. Code §8336).",
    deliveryNote:
      "The request must be in writing and state your purpose, which must relate to your interests as a member (Corp. Code §8330). The list may only be used for that kind of purpose: no selling it and no commercial use (Corp. Code §8338).",
    recommendedMethod: "certified_rr",
    mailTier: "certified",
    defaultPrivate: true,
  },
  {
    id: "insurance_review",
    label: "Review the HOA's insurance policies",
    short: "Insurance review",
    description:
      "Ask for the full policy wording (for example State Farm forms CMP-4101 and CMP-4696), plus the earthquake and umbrella policies and any claims filed.",
    legalBasis: "Civ. Code §5300(b)(9); budget packet p. 3; records under §5200",
    dayType: "business",
    days: 10,
    deadlineKind: "followup",
    ifMissed:
      "No separate statutory deadline; the policies are association records, so treat a non-response as a records-request denial.",
    recommendedMethod: "certified_rr",
    mailTier: "certified",
  },
  {
    id: "maintenance",
    label: "Maintenance request or notice of a problem",
    short: "Maintenance notice",
    description:
      "Notify the Board in writing of a Common Area problem (leak, roof, plumbing, structural) and ask for investigation and repair.",
    legalBasis: "CC&R §6.3(c), §2.7(d), §3.7(a)",
    dayType: "calendar",
    days: 14,
    deadlineKind: "followup",
    ifMissed:
      "No fixed deadline. A dated written notice builds the record that the Board knew. Follow up, then consider meet and confer (CC&R §12.5).",
    recommendedMethod: "certified",
    mailTier: "first_class",
  },
  {
    id: "meet_confer",
    label: "Meet and confer (Internal Dispute Resolution)",
    short: "Meet & confer (IDR)",
    description:
      "Formal request that the Board meet with you to resolve a dispute. The Association may not refuse. The letter automatically includes a copy of CC&R §12.5.",
    legalBasis: "CC&R §12.5(b); Civ. Code §§5900–5920",
    dayType: "calendar",
    days: 30,
    deadlineKind: "ccr",
    ifMissed:
      "Deemed denied under CC&R §12.5(b)(ii), but the Association is not permitted to refuse, so a missed deadline is itself a violation. Next step: Request for Resolution (ADR).",
    deliveryNote: "Serve it under CC&R §14.12: personal delivery or first-class mail. Email counts only if the Board agreed to email in writing.",
    recommendedMethod: "certified_rr",
    mailTier: "certified_rr",
  },
  {
    id: "adr_request",
    label: "Request for Resolution (ADR / mediation)",
    short: "Request for Resolution",
    description:
      "Offer alternative dispute resolution (usually mediation) before filing suit. Required before many lawsuits to enforce the governing documents.",
    legalBasis: "Civ. Code §§5925–5965 (esp. §5935, §5940, §5945)",
    dayType: "calendar",
    days: 30,
    deadlineKind: "statutory",
    ifMissed:
      "Deemed rejected (Civ. Code §5935(c)). If accepted, ADR must be completed within 90 days. Serving the request tolls the statute of limitations (§5945).",
    deliveryNote: "Civ. Code §5935(b): personal delivery, first-class mail, express mail, fax, or other means reasonably calculated to give actual notice.",
    recommendedMethod: "certified_rr",
    mailTier: "certified_rr",
  },
  {
    id: "architectural",
    label: "Architectural / flooring approval",
    short: "Architectural approval",
    description:
      "Prior written approval for improvements, including ANY floor-covering or underlayment replacement (carpet is required above the first floor except kitchen, laundry and bath).",
    legalBasis: "CC&R §7.3, §5.4(b); Civ. Code §4765",
    dayType: "calendar",
    days: 60,
    deadlineKind: "ccr",
    ifMissed: "Deemed denied (CC&R §7.3); you may resubmit. Solar applications are deemed approved instead.",
    deliveryNote:
      "CC&R §7.3 requires personal delivery or certified mail to the Secretary (or Architectural Committee chair). Get a written, dated receipt.",
    recommendedMethod: "certified_rr",
    mailTier: "certified_rr",
    requiresCertified: true,
  },
  {
    id: "architectural_appeal",
    label: "Appeal of an architectural decision",
    short: "Architectural appeal",
    description: "Appeal a disapproval to the Board. Must be received within 30 days of the committee's final decision.",
    legalBasis: "CC&R §7.8",
    dayType: "calendar",
    days: 30,
    deadlineKind: "ccr",
    ifMissed: "If the Board does not decide in writing within 30 days, the appeal is deemed decided in your favor (CC&R §7.8).",
    recommendedMethod: "certified_rr",
    mailTier: "certified_rr",
  },
  {
    id: "estoppel",
    label: "Estoppel certificate (improvements comply)",
    short: "Estoppel certificate",
    description: "Written certificate that the improvements in your unit comply with the governing documents.",
    legalBasis: "CC&R §7.13",
    dayType: "calendar",
    days: 30,
    deadlineKind: "ccr",
    ifMissed: "Follow up in writing; consider meet and confer (CC&R §12.5).",
    deliveryNote: "Requires a written demand plus any fee the Board has set.",
    recommendedMethod: "certified_rr",
    mailTier: "certified",
  },
  {
    id: "lease",
    label: "Lease approval",
    short: "Lease approval",
    description: "Prior written approval to lease your unit.",
    legalBasis: "CC&R §5.3 (leasing)",
    dayType: "calendar",
    days: 10,
    deadlineKind: "ccr",
    ifMissed: "Permission is deemed granted if no response reaches your address of record within 10 days.",
    recommendedMethod: "certified_rr",
    mailTier: "certified",
  },
  {
    id: "seller_docs",
    label: "Seller / escrow disclosure documents",
    short: "Seller documents",
    description: "Documents the association must provide when an owner sells (governing documents, budget, reserve summary, etc.).",
    legalBasis: "Civ. Code §§4525, 4530",
    dayType: "calendar",
    days: 10,
    deadlineKind: "statutory",
    ifMissed: "The association may not withhold the documents except for permitted fees; it can be liable for damages and a civil penalty.",
    recommendedMethod: "email_copy",
    mailTier: "certified",
  },
  {
    id: "special_meeting",
    label: "Petition for a special members' meeting",
    short: "Special meeting petition",
    description:
      "Members holding 5% of the votes (2 of 22 owners) can demand a special meeting, including a recall or a vote to reverse a rule change.",
    legalBasis: "Corp. Code §§7510(e), 7511(c); Civ. Code §4625; CC&R §3.8(e)",
    dayType: "calendar",
    days: 20,
    deadlineKind: "statutory",
    ifMissed:
      "If the Board does not give notice within 20 days, the petitioners may give notice themselves or seek a court order (Corp. Code §7510(e)). The meeting must be 35–90 days after the petition.",
    verify: true,
    recommendedMethod: "certified_rr",
    mailTier: "certified_rr",
  },
  {
    id: "general",
    label: "General letter to the Board",
    short: "General letter",
    description: "Any other written communication you want on the record.",
    legalBasis: "",
    dayType: null,
    days: null,
    deadlineKind: null,
    ifMissed: "",
    recommendedMethod: "first_class",
    mailTier: "first_class",
  },
];

export const METHODS: Record<Method, { label: string; note: string; transitDays: number }> = {
  personal: { label: "Personal delivery", note: "Valid notice (CC&R §14.12). Get a signed, dated receipt.", transitDays: 0 },
  first_class: { label: "First-class mail", note: "Valid notice; delivery complete on deposit (CC&R §14.12). No proof of receipt.", transitDays: 3 },
  certified: { label: "USPS Certified Mail", note: "Valid notice with a tracking number and delivery record.", transitDays: 3 },
  certified_rr: {
    label: "Certified Mail, return receipt",
    note: "Best proof: tracking plus a signed receipt showing the date the HOA received it.",
    transitDays: 3,
  },
  online_certified: {
    label: "Online certified mail service",
    note: "Upload the PDF; the service prints and mails it as Certified Mail and gives you tracking.",
    transitDays: 4,
  },
  email_consent: {
    label: "Email (recipient agreed in writing)",
    note: "Valid only if the HOA agreed to electronic delivery in writing (CC&R §14.12(3)).",
    transitDays: 0,
  },
  email_copy: {
    label: "Email copy only",
    note: "A timestamped courtesy copy. Not formal notice unless the HOA consented to email in writing.",
    transitDays: 0,
  },
};

export const STATUSES: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  received: "Received by HOA",
  acknowledged: "Acknowledged",
  answered: "Answered",
  deemed_denied: "Deemed denied",
  deemed_approved: "Deemed approved",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

export function requestType(id: string): RequestType | undefined {
  return REQUEST_TYPES.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Dates. All dates are plain "YYYY-MM-DD" strings in local (Pacific) terms.
// ---------------------------------------------------------------------------

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  // Pacific date, regardless of the viewer's timezone
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  // n-th (1-based) weekday of month; n = -1 means last
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return iso(new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7)));
  }
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return iso(new Date(Date.UTC(year, month, last.getUTCDate() - offset)));
}

const holidayCache = new Map<number, Set<string>>();

/**
 * California judicial holidays (Code Civ. Proc. §135, Gov. Code §6700).
 * A holiday on Sunday is observed Monday; on Saturday, the preceding Friday.
 */
export function caHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const fixed = (m: number, d: number) => iso(new Date(Date.UTC(year, m, d)));
  const observe = (s: string) => {
    const dow = toDate(s).getUTCDay();
    if (dow === 0) return addDays(s, 1);
    if (dow === 6) return addDays(s, -1);
    return s;
  };
  const days = [
    observe(fixed(0, 1)), // New Year's Day
    nthWeekday(year, 0, 1, 3), // Martin Luther King Jr. Day
    observe(fixed(1, 12)), // Lincoln Day
    nthWeekday(year, 1, 1, 3), // Washington Day
    observe(fixed(2, 31)), // Cesar Chavez Day
    nthWeekday(year, 4, 1, -1), // Memorial Day
    observe(fixed(5, 19)), // Juneteenth
    observe(fixed(6, 4)), // Independence Day
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 8, 5, 4), // Native American Day
    observe(fixed(10, 11)), // Veterans Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving
    addDays(nthWeekday(year, 10, 4, 4), 1), // Day after Thanksgiving
    observe(fixed(11, 25)), // Christmas
  ];
  const set = new Set(days);
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(s: string): boolean {
  const d = toDate(s);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !caHolidays(d.getUTCFullYear()).has(s);
}

export function addBusinessDays(s: string, n: number): string {
  let cur = s;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur)) left--;
  }
  return cur;
}

/** Calendar-day deadlines that land on a weekend or holiday roll to the next business day (Code Civ. Proc. §12a). */
export function addCalendarDays(s: string, n: number): string {
  let cur = addDays(s, n);
  while (!isBusinessDay(cur)) cur = addDays(cur, 1);
  return cur;
}

export interface DeadlineInput {
  type: string;
  method?: Method | null;
  sentDate?: string | null;
  receivedDate?: string | null;
}

export interface DeadlineResult {
  startDate: string | null;
  startEstimated: boolean;
  dueDate: string | null;
  dayType: DayType | null;
  days: number | null;
  explanation: string;
}

/** The clock runs from the date the HOA receives the request. If that is not known yet, estimate it from the send date. */
export function computeDeadline(input: DeadlineInput): DeadlineResult {
  const t = requestType(input.type);
  const none: DeadlineResult = { startDate: null, startEstimated: false, dueDate: null, dayType: null, days: null, explanation: "" };
  if (!t || !t.days || !t.dayType) return { ...none, explanation: "No deadline applies to this request type." };

  let start = input.receivedDate ?? null;
  let estimated = false;
  if (!start && input.sentDate) {
    const transit = input.method ? METHODS[input.method].transitDays : 3;
    start = addCalendarDays(input.sentDate, transit);
    if (transit === 0) start = input.sentDate;
    estimated = transit > 0;
  }
  if (!start) {
    return { ...none, dayType: t.dayType, days: t.days, explanation: `${t.days} ${t.dayType} days from when the HOA receives it.` };
  }
  const due = t.dayType === "business" ? addBusinessDays(start, t.days) : addCalendarDays(start, t.days);
  const unit = t.dayType === "business" ? "business days (excluding weekends and California holidays)" : "calendar days";
  return {
    startDate: start,
    startEstimated: estimated,
    dueDate: due,
    dayType: t.dayType,
    days: t.days,
    explanation: `${t.days} ${unit} from ${estimated ? "estimated" : ""} receipt on ${start}.`.replace("  ", " "),
  };
}

export type Urgency = "none" | "ok" | "soon" | "due" | "overdue" | "done";

const OPEN = new Set(["sent", "received", "acknowledged"]);

export function urgency(status: string, dueDate: string | null, today = todayISO()): Urgency {
  if (!OPEN.has(status)) return status === "draft" ? "none" : "done";
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due";
  if (dueDate <= addDays(today, 5)) return "soon";
  return "ok";
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}
