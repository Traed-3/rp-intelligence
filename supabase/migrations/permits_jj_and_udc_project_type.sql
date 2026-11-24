-- Permits: J&J Electric pulls Maryland/WV electrical (Hash's license is VA only),
-- and product-line / UDC jobs need their own project type.
ALTER TABLE con_permits DROP CONSTRAINT IF EXISTS con_permits_pulled_by_check;
ALTER TABLE con_permits ADD CONSTRAINT con_permits_pulled_by_check
  CHECK (pulled_by = ANY (ARRAY['Hash Construction','J&J Electric','RPS','Engineering Firm']));

ALTER TABLE con_permit_projects DROP CONSTRAINT IF EXISTS con_permit_projects_project_type_check;
ALTER TABLE con_permit_projects ADD CONSTRAINT con_permit_projects_project_type_check
  CHECK (project_type = ANY (ARRAY['Dispenser Replacement','STP Circuit Repair','Tank Replacement','MUL Conversion','Product Line / UDC Replacement']));
