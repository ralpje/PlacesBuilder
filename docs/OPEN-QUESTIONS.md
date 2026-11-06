# What is verified and what is still open

## Verified in a test tenant (2026-10-31)
- An IMDF zip from this app with building, footprint, level and unit (plus address, venue and manifest), with the Places PlaceId in `properties.directory_id`, is accepted by `New-Map` directly. No `Import-MapCorrelations` is needed. Places reported: floors 2, rooms 2.
- Rooms show on the map with the right position and orientation.
- `Import-MapCorrelations` (first run) accepts our package. Its `mapfeatures.csv` has the columns `PlaceId, Name, Type, FeatureType, FeatureId, FeatureName, FeatureCategory`; the app exports the same format (`mapfeatures.csv`).
- Microsoft's correlated output sets `directory_id` and normalises every file to a fixed property set (nulls where unused); the app writes the same shape.
- Sections, workspaces and desks (desks as fixtures, the default) import and show in Places; desk rotation is correct. Desks as units were not tested.
- A floor in a Places export can lack a SortOrder (`Features` is `{ }`). The import then warns and uses the number in the floor name.

## Still open
1. Desks as units (`workspace`/`desk`, the per-office alternative to fixtures) are not tested. See IMDF_ASSUMPTIONS in src/shared/imdf.ts. ([#45](https://github.com/ralpje/placesbuilder/issues/45))
2. The property set Microsoft writes for section and fixture files is unknown; ours were accepted. Category values Places accepts for sections beyond the default. ([#46](https://github.com/ralpje/placesbuilder/issues/46))
3. Behaviour with large floors (many rooms) and several floors on one position. ([#47](https://github.com/ralpje/placesbuilder/issues/47))
4. Whether unit `building_ids` are required/accepted (it was accepted). ([#48](https://github.com/ralpje/placesbuilder/issues/48))
5. Group claims in Easy Auth for the second access check (token size/overage with many groups). ([#50](https://github.com/ralpje/placesbuilder/issues/50))
6. Whether the Microsoft-style capitalised file names or a missing manifest matter (our lowercase names with manifest were accepted). ([#48](https://github.com/ralpje/placesbuilder/issues/48))
7. How Places SortOrder is set for floors that have none (probably `Set-PlaceV3 -SortOrder`, not checked). ([#49](https://github.com/ralpje/placesbuilder/issues/49))
8. Which unit categories Places accepts and shows, and whether it rejects a valid but unlisted one or an invalid one. The editor offers a catalog based on documentation and field reports (docs/places-categories.md). ([#64](https://github.com/ralpje/placesbuilder/issues/64))
