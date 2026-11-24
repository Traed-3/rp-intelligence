#!/usr/bin/env python3
"""
Read a classic RP QUOTE workbook (Sheet1 face: numbered lines with QUANTITY / UNIT COST /
MATERIAL or LABOR HOURS / LABOR RATE / TOTAL LABOR) and print the same JSON that
scripts/import-rev19-quote.ts loads — so the old-style quotes land in Billing with each
line filed under its REV19 category.

Materials (a quantity and a unit cost) go to categories 1–5 / 10 by their group header or
keywords; services (hours × rate) go to labor, lodging, equipment, subs, permits.
"Sub mark up 15%" rows are dropped — the engine adds that on category 11 itself.

    python3 scripts/parse-rp-quote-workbook.py "<workbook>.xlsx" > quote.json
"""
import json, re, sys, datetime
import openpyxl

def num(v):
    try: return float(v) if v not in (None, "") else None
    except (TypeError, ValueError): return None

def txt(v):
    if isinstance(v, datetime.datetime): return v.strftime("%m/%d/%Y")
    s = str(v).strip() if v is not None else ""
    return s or None

PN = re.compile(r"^\s*([A-Z0-9][A-Z0-9.\-/]{2,})\s+-\s+(.+)$", re.I)

def material_category(desc, group):
    d, g = desc.lower(), (group or "").lower()
    if "electrical" in g or re.search(r"\bthhn\b|\bwire\b|conduit|seal off|junction box|twisted pair|reducer|nipple|erickson|pull 90|union", d): return 1
    if "hard pip" in d: return 2
    if re.search(r"concrete|rebar|gravel|stone|backfill|sono tube", d): return 5
    if re.search(r"disposable|dot barrel|acetone|rags|gloves", d): return 10
    return 4

def service_line(desc):
    """Category + shape for an hours × rate row."""
    d = desc.lower()
    if "labor" in d: return 7
    if re.search(r"hotel|per ?diem|lodging", d): return 6
    if "permit" in d: return 12
    if re.search(r"equipment|fence", d): return 9
    if re.search(r"disposal fee", d) and "barrel" not in d: return 5
    if re.search(r"\bsub\b|vac truck|trip charge|fuel|barrel disposal|crompco|testing", d): return 11
    if re.search(r"sampling|inspection|budget", d): return 12
    return 9

def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    header = {
        "customer": txt(ws["B13"].value), "site_number": txt(ws["L13"].value), "facility_address": txt(ws["L14"].value), "city_state_zip": txt(ws["L15"].value),
        "proposal_date": txt(ws["N7"].value), "bid_due": None, "csr_number": txt(ws["N8"].value),
        "project_manager": None, "construction_manager": None, "foreman": None, "compiled_by": None,
        "signer_name": None, "signer_title": None,
    }
    attn, description = txt(ws["C17"].value), txt(ws["E21"].value)
    lines, section, group, labor_rate, extra_scope = [], None, None, None, []
    sales_tax = po = None; total = None
    for r in range(22, ws.max_row + 1):
        a, b = txt(ws.cell(r, 1).value), txt(ws.cell(r, 2).value)
        A = (a or "").upper()
        if A.startswith("BASIC INSTALLATION") and "TOTAL" not in A: section = "basic"; continue
        if A.startswith("ADDITIONAL SCOPE") and ws.cell(r, 10).value == "MATERIAL":
            section = "additional"; group = None
            m = re.search(r"TOTAL:\s*(.+)$", a or "")
            if m: extra_scope.append({"scope": "ADDITIONAL SCOPE OF WORK", "description": m.group(1).strip()})
            continue
        if A.startswith("GRAND TOTAL"): section = None
        if A.startswith("PROFIT AND OVERHEAD"): po = num(ws.cell(r, 13).value) or 0
        if A.startswith("SALES TAX"): sales_tax = num(ws.cell(r, 13).value) or 0
        if A.startswith("PROPOSAL GRAND TOTAL"): total = num(ws.cell(r, 14).value)
        if r >= 95 and b and not header["signer_name"] and ws.cell(r, 7).value not in (None, "DATE") and num(ws.cell(r, 1).value) is None:
            header["signer_name"] = b; header["signer_title"] = txt(ws.cell(r + 1, 2).value)
        if section is None or num(ws.cell(r, 1).value) is None or not b: continue
        qty, unit, hours, rate = num(ws.cell(r, 8).value), num(ws.cell(r, 9).value), num(ws.cell(r, 11).value), num(ws.cell(r, 12).value)
        if not (qty and unit) and not (hours and rate):
            group = b; continue                                     # a group header row like "Electrical material"
        if re.search(r"sub mark ?up", b, re.I): continue           # the engine adds the 15% on category 11
        m = PN.match(b)
        pn, desc = (m.group(1), m.group(2).strip()) if m else (None, b.strip())
        if qty and unit:
            cat = material_category(desc, group)
            lines.append({"section": section, "category": cat, "part_number": pn, "description": desc, "quantity": qty, "unit_cost": unit,
                          "markup_applies": cat == 5, "freight_per_unit": 0, "source_note": "Workbook price — VERIFY", "price_flag": "verify"})
        else:
            cat = service_line(desc)
            if cat == 7:
                labor_rate = labor_rate or rate
                lines.append({"section": section, "category": 7, "day_label": "ALL DAYS", "description": desc.upper(), "men": 1, "hrs_each": hours, "labor_rate": rate, "crew": "construction", "source_note": "Workbook hours — break out by day", "price_flag": "verify"})
            else:
                lines.append({"section": section, "category": cat, "part_number": None, "description": desc, "quantity": hours, "unit_cost": rate, "markup_applies": False,
                              "source_note": "Workbook price — VERIFY", "price_flag": "verify"})
    inputs = {"material_markup_pct": 0, "material_tax_pct": 0, "sub_markup_pct": 0.15, "labor_rate": labor_rate or 0,
              "contingency_pct": 0, "contingency_flat": 0, "profit_overhead_pct": po or 0, "sales_tax_pct": sales_tax or 0}
    print(json.dumps({"source_file": path.split("/")[-1], "header": header, "attn": attn, "project_description": description,
                      "scope_rows": extra_scope, "inputs": inputs, "lines": lines, "workbook_total": total}, indent=2))

if __name__ == "__main__":
    main(sys.argv[1])
