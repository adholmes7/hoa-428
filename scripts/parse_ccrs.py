"""Split the CC&R text into sections for the database.

Usage: python3 -I scripts/parse_ccrs.py private-data/text/428_HillStreet_CCRs_Final.txt private-data/seed/ccr_sections.json

Pages in the text file are separated by form feeds; page N of the text is PDF page N.
Printed page = PDF page - 10 (from the brief).
"""
import json
import re
import sys

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8,
         "IX": 9, "X": 10, "XI": 11, "XII": 12, "XIII": 13, "XIV": 14}
FOOTER = re.compile(
    r"^\s*(\d+\s+)?(Amended and Restated Declaration|of Covenants, Conditions and Restrictions"
    r"|for Four Twenty-Eight Hill Street Homeowners Association|Final)\s*$"
)
PAGE_NO = re.compile(r"^\s*\d{1,3}\s*$")
SECTION = re.compile(r"^\s+Section (\d{1,2})\.(\d{1,2})\.?\s+(.*)$")
ARTICLE = re.compile(r"^\s+ARTICLE ([IVX]+)\s*$")
BODY_START_PAGE = 11  # first PDF page of the body (Recitals); TOC precedes it


def key(num):
    a, b = num.split(".")
    return (int(a), int(b))


def main(src, dst):
    pages = open(src, encoding="utf-8").read().split("\f")
    sections = []
    article_titles = {}
    cur = {"id": "recitals", "article": 0, "title": "Recitals", "pdf_page": BODY_START_PAGE, "lines": []}
    pending_article = None
    last_key = (0, 0)

    for idx in range(BODY_START_PAGE - 1, len(pages)):
        pdf_page = idx + 1
        lines = pages[idx].split("\n")
        i = 0
        while i < len(lines):
            line = lines[i]
            if FOOTER.match(line) or PAGE_NO.match(line):
                i += 1
                continue
            m_art = ARTICLE.match(line)
            if m_art and m_art.group(1) in ROMAN:
                n = ROMAN[m_art.group(1)]
                # next non-empty line is the article title
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                title = lines[j].strip().title() if j < len(lines) else ""
                article_titles[n] = title
                pending_article = n
                if n == 13:  # Article XIII has no numbered sections
                    sections.append(cur)
                    cur = {"id": "13", "article": 13, "title": "Amendments", "pdf_page": pdf_page, "lines": []}
                i = j + 1
                continue
            m = SECTION.match(line)
            if m:
                k = (int(m.group(1)), int(m.group(2)))
                if k > last_key and (pending_article is None or k[0] == pending_article or k[0] == last_key[0]):
                    title = m.group(3).strip()
                    if not title.endswith(".") and i + 1 < len(lines):
                        nxt = lines[i + 1].strip()
                        if nxt and len(nxt) < 50 and not nxt.startswith("("):
                            title = f"{title} {nxt}"
                            i += 1
                    title = re.sub(r"\s+", " ", title).rstrip(".")
                    first_lines = []
                    # Some definitions run the body onto the heading line ("Board means ...")
                    m_def = re.match(r"^(.*?)\s+((?:shall )?means?\s.*)$", title)
                    if m_def and len(m_def.group(1)) < 40:
                        title = m_def.group(1)
                        first_lines.append((pdf_page, f"{title} {m_def.group(2)}"))
                    sections.append(cur)
                    cur = {"id": f"{k[0]}.{k[1]}", "article": k[0], "title": title,
                           "pdf_page": pdf_page, "lines": first_lines}
                    last_key = k
                    pending_article = None
                    i += 1
                    continue
            if line.strip().startswith("IN WITNESS WHEREOF") and cur["id"] != "exhibits":
                sections.append(cur)
                cur = {"id": "exhibits", "article": 15, "title": "Signatures and Exhibits",
                       "pdf_page": pdf_page, "lines": []}
                article_titles[15] = "Signatures and Exhibits"
            cur["lines"].append((pdf_page, line))
            i += 1
    sections.append(cur)

    out = []
    for s in sections:
        pages_seen = [p for p, l in s["lines"] if l.strip()]
        end_page = max(pages_seen) if pages_seen else s["pdf_page"]
        text = "\n".join(l for _, l in s["lines"])
        text = re.sub(r"\n{3,}", "\n\n", text).strip("\n")
        # A page footer removed mid-sentence leaves a blank line; rejoin those sentences
        text = re.sub(r"([a-z,;])\n[ \t]*\n([ \t]*[a-z])", r"\1\n\2", text)
        out.append({
            "id": s["id"],
            "article": s["article"],
            "article_title": article_titles.get(s["article"], "Recitals" if s["article"] == 0 else ""),
            "title": s["title"],
            "pdf_page": s["pdf_page"],
            "pdf_page_end": end_page,
            "printed_page": s["pdf_page"] - 10,
            "sort": s["article"] * 1000 + (int(s["id"].split(".")[1]) if "." in s["id"] else 0),
            "text": text,
        })
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"{len(out)} sections written to {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
