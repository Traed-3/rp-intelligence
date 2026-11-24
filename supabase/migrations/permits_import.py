import json, re, sys

SP = "/tmp/claude-0/-home-user-rps-maintenance/74f9fc08-b61a-5508-a897-f58f7fc4e1d7/scratchpad"
CO = "f3d06874-2e21-40f3-a7d0-a1d86bad02e7"
d = json.load(open(f"{SP}/permit_tracker.json"))

def rows(tab):
    h = d[tab][0]
    return [dict(zip(h, r)) for r in d[tab][1:]]

perm = rows("permits")
jur = rows("jurisdictions")
deliv = rows("deliverables")

def q(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

def qd(v):
    # date or NULL; only accept YYYY-MM-DD
    if v and re.match(r"^\d{4}-\d{2}-\d{2}$", str(v).strip()):
        return "'" + v.strip() + "'"
    return "NULL"

out = []
out.append("-- ============================================================")
out.append("-- RPS Permits — data importer (generated from RPS_Permit_Tracker.xlsx)")
out.append("-- Loads Jurisdiction Contacts, Permits, and Deliverables Log tabs.")
out.append("-- Idempotent: clears this company's permit data first, then reloads.")
out.append("-- ============================================================")
out.append("BEGIN;")
CID = q(CO)
# wipe (children first) so re-running is clean
for t in ["con_permit_events", "con_permit_deliverables", "con_permits",
          "con_permit_projects", "con_permit_sites", "con_jurisdictions",
          "con_contractor_licenses"]:
    out.append(f"DELETE FROM {t} WHERE company_id = {CID};")
out.append("")

# ---- jurisdictions ----
indep = lambda n: n.startswith("City of") or n.endswith("City")
out.append("-- Jurisdictions (16)")
for j in jur:
    name = j["Jurisdiction"]
    method = j.get("Portal / Submittal Method", "") or ""
    portal = None
    m = re.search(r"(https?://\S+|[\w.-]+\.(?:portal|opengov|gov)\S*)", method)
    if m:
        portal = m.group(1)
    out.append(
        "INSERT INTO con_jurisdictions (company_id,name,state,is_independent_city,department,"
        "contact_name,phone,email,portal_url,submittal_method,typical_turnaround_days,fee_notes,cheat_sheet) VALUES ("
        f"{CID},{q(name)},{q(j.get('State'))},{str(indep(name)).lower()},{q(j.get('Department'))},"
        f"{q(j.get('Contact Name'))},{q(j.get('Direct Phone'))},{q(j.get('Email'))},{q(portal)},"
        f"{q(method)},{q(j.get('Turnaround'))},{q(j.get('Fee Notes'))},{q(j.get('Cheat Sheet Notes'))});"
    )
out.append("")

# jurisdiction name resolution for permit rows
jset = {j["Jurisdiction"] for j in jur}
alias = {"Culpeper County": "Culpeper (town vs county)"}
def resolve_juris(raw):
    if not raw:
        return None
    base = re.sub(r",\s*[A-Z]{2}\s*$", "", raw).strip()
    if base in jset:
        return base
    if base in alias:
        return alias[base]
    return None  # e.g. Frederick County MD not in contacts

def juris_sub(name):
    if name is None:
        return "NULL"
    return f"(SELECT id FROM con_jurisdictions WHERE company_id={CID} AND name={q(name)})"

def brand_owner(site_name, site_num):
    n = (site_name or "")
    if site_num == "45967":
        return "Speedway", "Speedway"
    if str(site_num).startswith("HM"):
        return "Handy Mart", "H.N. Funkhouser & Co."
    if "7-Eleven" in n or "7-eleven" in n.lower():
        return "7-Eleven", "7-Eleven, Inc."
    return None, None

# ---- sites (unique by site number, in first-seen order) ----
sites = {}
for r in perm:
    sn = r["Site #"]
    if sn not in sites:
        sites[sn] = r
out.append(f"-- Permit sites ({len(sites)})")
for sn, r in sites.items():
    brand, owner = brand_owner(r.get("Site Name"), sn)
    jn = resolve_juris(r.get("Jurisdiction"))
    out.append(
        "INSERT INTO con_permit_sites (company_id,site_number,brand,name,address,city,state,jurisdiction_id,owner_name) VALUES ("
        f"{CID},{q(sn)},{q(brand)},{q(r.get('Site Name'))},{q(r.get('Address'))},{q(r.get('City'))},"
        f"{q(r.get('State'))},{juris_sub(jn)},{q(owner)});"
    )
out.append("")

def site_sub(sn):
    return f"(SELECT id FROM con_permit_sites WHERE company_id={CID} AND site_number={q(sn)})"
def project_sub(sn):
    return (f"(SELECT p.id FROM con_permit_projects p JOIN con_permit_sites s ON s.id=p.site_id "
            f"WHERE s.company_id={CID} AND s.site_number={q(sn)} LIMIT 1)")

# ---- projects (one per site) ----
out.append(f"-- Permit projects ({len(sites)}, one per site)")
for sn, r in sites.items():
    out.append(
        "INSERT INTO con_permit_projects (company_id,site_id,project_type,request_type,scheduled_work_date) VALUES ("
        f"{CID},{site_sub(sn)},{q(r.get('Project Type'))},{q(r.get('Request Type'))},{qd(r.get('Scheduled Work Date'))});"
    )
out.append("")

# ---- permits (25 from spreadsheet, all Required) ----
out.append(f"-- Permits from spreadsheet ({len(perm)})")
present = {}  # site -> set(types)
for r in perm:
    sn = r["Site #"]
    present.setdefault(sn, set()).add(r["Permit Type"])
    out.append(
        "INSERT INTO con_permits (company_id,project_id,permit_key,permit_type,pulled_by,requirement_status,status,"
        "other_permits_required,notes) VALUES ("
        f"{CID},{project_sub(sn)},{q(r.get('Permit ID'))},{q(r.get('Permit Type'))},{q(r.get('Pulled By'))},"
        f"{q(r.get('Requirement'))},{q(r.get('Status'))},{q(r.get('Other Permits Required'))},{q(r.get('Notes'))});"
    )
out.append("")

# Building/Mechanical permits are added by hand on the rare occasions a
# jurisdiction wants them, so we do NOT auto-create Unknown placeholders.

# ---- deliverables (17) ----
out.append(f"-- Deliverables ({len(deliv)})")
real = set(sites.keys())
for x in deliv:
    sn = x.get("Site #")
    sid = site_sub(sn) if sn in real else "NULL"
    out.append(
        "INSERT INTO con_permit_deliverables (company_id,site_id,created_date,type,filename,where_it_lives,open_items) VALUES ("
        f"{CID},{sid},{qd(x.get('Date'))},{q(x.get('Deliverable'))},{q(x.get('File Name'))},"
        f"{q(x.get('Where It Lives'))},{q(x.get('Open Items'))});"
    )
out.append("")

# ---- contractor licenses ----
out.append("-- Contractor licenses (RPS + Hash, both Virginia Class A)")
out.append(
    "INSERT INTO con_contractor_licenses (company_id,contractor_name,license_number,license_class,state,expiration_date) VALUES "
    f"({CID},'RPS','2705096729','A','VA','2027-01-31'),"
    f"({CID},'Hash Construction','2705048270','A','VA','2027-03-31');"
)
out.append("")
out.append("COMMIT;")

open(f"{SP}/permits_seed.sql", "w").write("\n".join(out))
print("sites:", len(sites))
print("permits(spreadsheet):", len(perm))
print("jurisdictions:", len(jur))
print("deliverables:", len(deliv))
print("wrote permits_seed.sql")
