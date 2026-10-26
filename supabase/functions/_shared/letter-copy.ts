// Wording of the email copy of a request letter. Shared by the server (which sends it) and the website
// (which previews it before sending), so the preview always matches what goes out.

export const isEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);

/** The HOA addresses from Admin settings: the manager email plus any board emails (comma or line separated). */
export function hoaRecipients(association: Record<string, unknown>): string[] {
  const raw = [association.email, association.board_email].filter((x) => typeof x === "string").join(",");
  return [...new Set(raw.split(/[,;\n]/).map((s) => s.trim()).filter(isEmail))];
}

export type LetterCopyInput = {
  refNo: number;
  subject: string;
  ownerName: string;
  ownerEmail: string | null;
  hoa: string[];
  howSent: string; // e.g. "Certified Mail via USPS, mailing 2026-10-27 (tracking 9407...)"
  test: boolean;
  letterText?: string | null; // the letter itself, quoted in the email for reference
};

export type LetterCopy = { to: string[]; cc: string[]; replyTo: string[]; subject: string; text: string; attachment: string };

/**
 * The HOA gets the email with the owner copied and replies going to the owner.
 * In test mode only the owner gets it, so the board never receives a copy of a letter that wasn't mailed.
 */
export function composeLetterCopy(c: LetterCopyInput): LetterCopy {
  const owner = c.ownerEmail && isEmail(c.ownerEmail) ? [c.ownerEmail] : [];
  const hoa = c.test ? [] : c.hoa;
  const to = hoa.length ? hoa : owner;
  const cc = hoa.length ? owner : [];
  const lines = c.test
    ? [
        `Hi ${c.ownerName},`,
        "",
        `This is a test copy of request #${c.refNo}. The mailing service is in test mode, so nothing was mailed and the board was not emailed.`,
      ]
    : hoa.length
      ? [
          "To the Board of Directors,",
          "",
          `Attached is a copy of a letter from ${c.ownerName}, sent to the Association by ${c.howSent}. This email is a courtesy copy for reference; the mailed letter is the formal delivery.`,
          "",
          `Please reply to ${c.ownerName}${owner.length ? ` at ${owner[0]}` : ""}.`,
        ]
      : [`Hi ${c.ownerName},`, "", `Attached is your copy of request #${c.refNo}, sent by ${c.howSent}.`];
  return {
    to,
    cc,
    replyTo: owner,
    subject: `${c.test ? "[TEST, not mailed] " : ""}${c.subject} (Unit owner request #${c.refNo})`.slice(0, 250),
    text: [...lines, ...quoteLetter(c.letterText), "", "Sent from the 428 Hill Street owners' portal."].join("\n"),
    attachment: `request-${c.refNo}.pdf`,
  };
}

/** How the letter went, for the email text. The preview passes placeholders for the date and tracking number Lob assigns. */
export function howSentText(label: string, date?: string | null, tracking?: string | null) {
  return `${label} via USPS${date ? `, mailing ${date}` : ""}${tracking ? ` (tracking ${tracking})` : ""}`;
}

/**
 * The HOA's envelope address as Lob prints it. Lob allows 40 characters for the name and company lines,
 * so a long association name is shortened ("... Homeowners Association" -> "... HOA") rather than cut off.
 */
export function envelopeTo(a: { name: string; care_of: string; street: string; city_state_zip: string }) {
  const company = a.name.length <= 40 ? a.name : a.name.replace(/\s*Homeowners'? Association$/i, " HOA").slice(0, 40);
  return { name: `Board of Directors${a.care_of ? `, ${a.care_of}` : ""}`.slice(0, 40), company, street: a.street, cityStateZip: a.city_state_zip };
}

// The letter text below the note, so it can be read without opening the PDF (the PDF stays attached as the signed copy)
function quoteLetter(letter?: string | null): string[] {
  const body = (letter ?? "")
    .replace(/\f/g, "\n")
    .replace(/^\s*_{10,}\s*$/m, "[Signature: see the attached PDF]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) return [];
  return ["", "The letter's text is below for reference. The attached PDF is the signed copy that was mailed.", "", "---------- Letter ----------", "", body, "", "---------- End of letter ----------"];
}
