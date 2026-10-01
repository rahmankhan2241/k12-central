# Builds a Zety-style "Cubic" resume for Shane Rahman (reconstructed from video frames)
import re
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BODY_FONT = "EB Garamond"
LINK_BLUE = "2A5DB0"

doc = Document()

# --- Page setup: Letter size, ~0.7in left/right, ~0.55in top, ~0.4in bottom ---
sec = doc.sections[0]
sec.page_width = Inches(8.5)
sec.page_height = Inches(11)
sec.left_margin = Inches(0.7)
sec.right_margin = Inches(0.7)
sec.top_margin = Inches(0.5)
sec.bottom_margin = Inches(0.4)

# --- Base style ---
style = doc.styles["Normal"]
style.font.name = BODY_FONT
style.font.size = Pt(11.5)
style.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)
rpr = style.element.get_or_add_rPr()
rfonts = rpr.find(qn("w:rFonts"))
if rfonts is None:
    rfonts = OxmlElement("w:rFonts")
    rpr.append(rfonts)
rfonts.set(qn("w:ascii"), BODY_FONT)
rfonts.set(qn("w:hAnsi"), BODY_FONT)
rfonts.set(qn("w:cs"), BODY_FONT)
style.paragraph_format.space_before = Pt(0)
style.paragraph_format.space_after = Pt(0)
style.paragraph_format.line_spacing = 1.1

def add_para(text="", bold=False, italic=False, size=None, color=None,
             align=None, space_before=None, space_after=None, caps=False,
             small_caps=False, runs=None, line_spacing=None):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    if space_before is not None:
        pf.space_before = Pt(space_before)
    if space_after is not None:
        pf.space_after = Pt(space_after)
    if line_spacing is not None:
        pf.line_spacing = line_spacing
    items = runs if runs is not None else [(text, dict(bold=bold, italic=italic, size=size, color=color, caps=caps, small_caps=small_caps))]
    for txt, fmt in items:
        r = p.add_run(txt)
        r.font.name = BODY_FONT
        r.bold = fmt.get("bold", False)
        r.italic = fmt.get("italic", False)
        if fmt.get("size"):
            r.font.size = Pt(fmt["size"])
        if fmt.get("color"):
            r.font.color.rgb = RGBColor.from_string(fmt["color"])
        if fmt.get("small_caps"):
            r.font.small_caps = True
    return p

def set_link(run, url):
    rpr = run._element.get_or_add_rPr()
    hl = OxmlElement("w:hyperlink")
    hl.set(qn("r:id"), run.part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True))
    # We'll wrap run element inside hyperlink below
    run._element.addnext(hl)
    hl.append(run._element)

def add_hyperlink(paragraph, text, url, size=None, underline=True):
    part = paragraph.part
    r_id = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)
    new_run = OxmlElement("w:r")
    rPr = OxmlElement("w:rPr")
    rFonts = OxmlElement("w:rFonts")
    rFonts.set(qn("w:ascii"), BODY_FONT)
    rFonts.set(qn("w:hAnsi"), BODY_FONT)
    rPr.append(rFonts)
    if size:
        sz = OxmlElement("w:sz"); sz.set(qn("w:val"), str(int(size*2))); rPr.append(sz)
    color = OxmlElement("w:color"); color.set(qn("w:val"), LINK_BLUE); rPr.append(color)
    if underline:
        u = OxmlElement("w:u"); u.set(qn("w:val"), "single"); rPr.append(u)
    new_run.append(rPr)
    t = OxmlElement("w:t")
    t.text = text
    new_run.append(t)
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)
    return hyperlink

def add_hr(p, size=6, color="1A1A1A", space_after=2, space_before=2):
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), str(space_after))
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    pPr.append(pbdr)

def double_rule(p, size=8, color="1A1A1A"):
    add_hr(p, size=size, color=color)

def add_page_bottom_rule():
    # No-op; Zety has footer line only on rendered page bottom. Skip.
    pass

def section_heading(text):
    # Heading like:  -------  EDUCATION  -------
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pf = p.paragraph_format
    pf.space_before = Pt(7)
    pf.space_after = Pt(4)
    # left line
    r1 = p.add_run(" " * 0)
    r1.font.name = BODY_FONT
    # build with tab-free approach: use centered text with line via paragraph borders left/right is complex;
    # Simpler: use runs of em-dashes styled thin via small font and char spacing
    dash_r = p.add_run("—————")
    dash_r.font.name = BODY_FONT
    dash_r.font.size = Pt(9)
    dash_r.font.color.rgb = RGBColor(0x44, 0x44, 0x44)
    p.add_run("  ")
    t = p.add_run(text)
    t.font.name = BODY_FONT
    t.font.size = Pt(13)
    t.font.color.rgb = RGBColor(0x8B, 0x1A, 0x1A)
    t.font.small_caps = True
    p.add_run("  ")
    dash_r2 = p.add_run("—————")
    dash_r2.font.name = BODY_FONT
    dash_r2.font.size = Pt(9)
    dash_r2.font.color.rgb = RGBColor(0x44, 0x44, 0x44)
    return p

def bullet(text_runs, size=11.5):
    p = doc.add_paragraph(style="List Bullet")
    pf = p.paragraph_format
    pf.space_before = Pt(1)
    pf.space_after = Pt(1)
    pf.left_indent = Inches(0.25)
    pf.line_spacing = 1.15
    for txt, fmt in text_runs:
        r = p.add_run(txt)
        r.font.name = BODY_FONT
        r.font.size = Pt(size)
        r.bold = fmt.get("bold", False)
        if fmt.get("color"):
            r.font.color.rgb = RGBColor.from_string(fmt["color"])
    return p

# ================= HEADER =================
# Thin top border line (Zety page top hairline) - we skip page chrome and keep the thin rule above the name
p = add_para("", space_after=4)
add_hr(p, size=4, color="444444")

add_para("SHANE RAHMAN", bold=True, size=26, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=8)

add_para("DATA ANALYST", bold=True, size=13, align=WD_ALIGN_PARAGRAPH.CENTER, small_caps=True, space_after=6)

# Double rule under title
p = add_para("", space_after=8)
add_hr(p, size=10, color="1A1A1A")

# Contact line
pc = doc.add_paragraph()
pc.alignment = WD_ALIGN_PARAGRAPH.CENTER
pc.paragraph_format.space_after = Pt(2)
r = pc.add_run("Bangalore ◆ 9120458565 ◆ shanerahman2241@gmail.com ◆ ")
r.font.name = BODY_FONT; r.font.size = Pt(11.5)
r.bold = False
r2 = pc.add_run("LinkedIn: ")
r2.font.name = BODY_FONT; r2.font.size = Pt(11.5); r2.bold = True
add_hyperlink(pc, "linkedin.com/in/rahman2241", "https://linkedin.com/in/rahman2241", size=11.5)

# ================= PROFESSIONAL SUMMARY =================
section_heading("Professional Summary")
add_para("Data analyst skilled in SQL, Python, Excel, and Looker Studio, with experience automating supply chain reporting, building dashboards, and analyzing operational data to improve inventory planning and decision-making.",
         space_after=6, line_spacing=1.15)

# ================= SKILLS =================
section_heading("Skills")
skills_left = ["SQL", "Excel/Google Sheets", "Looker Studio", "Statistical Analysis", "Data visualization"]
skills_right = ["Python programming", "Power BI", "Critical Thinking", "Analytical thinking"]
tbl = doc.add_table(rows=len(skills_left), cols=2)
tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
tbl.autofit = False
for i in range(len(skills_left)):
    for j, txt in enumerate([skills_left[i] if i < len(skills_left) else "",
                             skills_right[i] if i < len(skills_right) else ""]):
        cell = tbl.cell(i, j)
        cell.width = Inches(2.75)
        cp = cell.paragraphs[0]
        cp.paragraph_format.space_after = Pt(2)
        r = cp.add_run(txt)
        r.font.name = BODY_FONT
        r.font.size = Pt(11.5)

# ================= EXPERIENCE =================
section_heading("Experience")

def exp_entry(title, dates, company, bullets_list):
    add_para(runs=[(title, dict(bold=True, size=11.5)), (", " + dates, dict(size=11.5))], space_before=3, space_after=0)
    add_para(company, bold=True, size=11.5, space_after=2)
    for b in bullets_list:
        bullet(b)

exp_entry("Data Analyst", "04/2025 - Current", "K12 Techno Services Pvt Ltd – Bengaluru, India", [
    [("Analyzed and automated supply chain data across branches, SKUs, zones, and product categories to support ", {}), ("inventory planning , procurement , and distribution decisions", dict(bold=True)), (" .", {})],
    [("Developed dashboards and technologies to provide actionable visibility into inventory, order fulfillment, stock availability, and supply chain performance.", {})],
    [("Analyzed large-scale operational datasets using SQL, Python, Excel, and Looker Studio to identify data inconsistencies, operational gaps, and opportunities for process improvement.", {})],
    [("Improved ", {}), ("inventory planning and decision-making", dict(bold=True)), (" by analyzing SKU-level demand, stock movement, delivery performance, and replenishment requirements.", {})],
    [("Built data-driven reporting solutions for cross-functional teams , enabling faster identification of exceptions, shortages, and performance issues across the supply chain.", {})],
])

exp_entry("Data Analyst Intern", "08/2024 - 03/2025", "K12 Techno Services Pvt Ltd – Bengaluru, India", [
    [("Analyzed datasets to identify trends supporting academic and business decision-making.", {})],
    [("Built dashboards and reports using Excel to simplify performance tracking.", {})],
    [("Collected, cleaned, and organized student and operational data for reporting accuracy.", {})],
    [("Validated data entries, resolved inconsistencies, and maintained reliable records.", {})],
])

# ================= EDUCATION =================
section_heading("Education")
add_para(runs=[("Bachelor of Science", dict(bold=True)), (": Mathematical Sciences, 05/2023", {})], space_after=0)
add_para("Dr. Rammanohar Lohia Avadh University - Ayodhya, India", bold=True, size=11.5, space_after=4)

# ================= ACCOMPLISHMENTS =================
section_heading("Accomplishments")
add_para("Best Performer Employee of AY 26-27", bold=True, space_after=4)

# Bottom page rule is part of the Zety page frame, not body content — omitted so the doc stays one page

doc.save("Recreated_Resume.docx")
print("Saved Recreated_Resume.docx")
