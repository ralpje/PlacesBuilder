# Unit categories and Microsoft Places

Researched 6 November 2026 (issue #63). **Microsoft publishes no list of supported categories**, so the catalog in `src/shared/categories.ts` is based on documentation, field reports and a vendor integration. It has not been tested in a tenant yet (issue #64).

## What the editor offers

Every category is a valid IMDF 1.0 unit category (a test compares the catalog with the IMDF list). Support levels: **icon** = Places shows an icon (reported, not documented), **named** = named by Microsoft Learn or used by a vendor's Places integration, **imdf** = valid IMDF, shown as a plain polygon, nothing special known.

| Group | Category (label) | Support | Note |
| --- | --- | --- | --- |
| Rooms | `room` (Room) | named | Microsoft: "rooms" |
| Rooms | `conferenceroom` (Meeting room) | named | Mappedin |
| Rooms | `office` (Office) | named | Mappedin |
| Rooms | `huddleroom`, `phoneroom` | imdf | |
| Facilities | `restroom` (Restroom) | **icon** | Essential Computing, Jan 2025 |
| Facilities | `kitchen` (Kitchen / coffee corner) | named | Microsoft: "kitchenettes"; Mappedin: encoded, no icon rendered |
| Facilities | `lounge` (Break-out), `foodservice` (Canteen), `lobby`, `storage`, `serverroom` | imdf | |
| Circulation | `elevator`, `stairs`, `escalator` | **icon** | stairs and escalator share one icon |
| Circulation | `walkway` (Corridor) | named | Microsoft: "walkways" |
| Circulation | `opentobelow` | imdf | |
| Other | `structure` (Wall) | named | Microsoft: walls are closed polygons in the unit file |
| Other | `nonpublic` | named | Mappedin: not bookable or navigable |
| Other | `unspecified` | named | Mappedin |

Workspaces and desks are not categories to pick: they are their own feature kinds (`workspace`, `desk`) with fixed Places conventions (see `IMDF_ASSUMPTIONS`).

## Can I label a coffee corner or a restroom?

- **Restroom: yes.** `restroom`, and Places shows an icon.
- **Coffee corner: not as such.** IMDF has no coffee category. Use `kitchen` ("Kitchen / coffee corner") and give the space the name "Coffee corner". Microsoft names "kitchenettes" under units; Places shows no kitchen or coffee icon (Essential Computing, Mappedin).

## What happens with anything else

- The editor only offers catalog categories. A feature that already has another value shows it as "not supported by Places" and can be changed.
- Saving a floor stores a unit category outside the catalog as `unspecified` (an empty one becomes `room`).
- The exporter writes `unspecified` for such a unit and names it in the export warnings; the validator shows the same as a warning.
- Valid IMDF categories that are not in the catalog (for example `classroom` or `restroom.female`) are treated the same way until it is verified how Places handles them.

## Sources

- [Microsoft Learn: configure maps in Places](https://learn.microsoft.com/en-us/microsoft-365/places/configure-maps-in-places): files and example objects; "other IMDF feature types aren't currently being rendered".
- [Essential Computing: Using icons with Microsoft Places](https://www.essential.co.uk/blog/articles/microsoft-places-icons/) (January 2025): icons for restroom, elevator, stairs/escalator; none for coffee, printer, kitchen, first aid. Own testing, not Microsoft documentation.
- [Mappedin: Microsoft Places mapping requirements](https://developer.mappedin.com/docs/integrations/workplace-management-and-collaboration/microsoft-places/mapping-requirements): categories used in a production integration.
- [IMDF 1.0 categories (OGC 20-094)](https://docs.ogc.org/cs/20-094/Categories/index.html): the 63 unit and 15 fixture categories.

## Not offered yet

- Fixture categories other than `desk` (`furniture`, `equipment`): needs a new feature kind in the editor.
- Restroom variants (`restroom.female`, `restroom.unisex`, `restroom.wheelchair`, ...): not known whether Places shows their icon.
