# Open questions (verify in a test tenant)
1. Desk representation: fixtures (`desk` icon) vs units (`workspace`/`desk`); switch per office. See IMDF_ASSUMPTIONS in src/shared/imdf.ts.
2. Section feature properties and category values Places accepts.
3. Fixture `rotation` semantics (degrees, direction).
4. Whether unit `building_ids` are required/accepted.
5. Exact columns of Microsoft's `mapfeatures.csv` after Import-MapCorrelations (the app currently emits its own correlation-map.csv).
6. Group claims in Easy Auth for the second access check (token size/overage with many groups).
7. pdf.js v6 worker import and maplibre v5 image-source behaviour were not run here (no npm access): report build errors.
