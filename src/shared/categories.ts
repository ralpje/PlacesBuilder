/**
 * The unit categories the editor offers.
 *
 * Microsoft Places publishes no list of supported categories (checked 6 November 2026). This catalog is what is
 * known from Microsoft Learn, field reports and a vendor integration; see docs/places-categories.md for the sources.
 * Every value is a valid IMDF 1.0 unit category (a test checks that). IMDF has no "coffee" category: a coffee
 * corner is a `kitchen` with its own name.
 *
 * Support levels:
 *  - icon:  Places shows an icon for it (reported by Essential Computing, January 2025; not documented by Microsoft)
 *  - named: named by Microsoft Learn or used by a vendor's Places integration, so it is a normal Places category
 *  - imdf:  valid IMDF, shown as a plain polygon; nothing special is known about it in Places
 */
export type CategorySupport = 'icon' | 'named' | 'imdf';
export type CategoryGroup = 'Rooms' | 'Facilities' | 'Circulation' | 'Other';

export interface CategoryInfo {
  value: string;
  label: string;
  group: CategoryGroup;
  support: CategorySupport;
  /** Shown in the editor under the selected category. */
  note: string;
}

export const UNIT_CATEGORY_CATALOG: readonly CategoryInfo[] = [
  { value: 'room', label: 'Room', group: 'Rooms', support: 'named', note: 'Named by Microsoft ("rooms"). A normal room; link it to a Places room to make it bookable.' },
  { value: 'conferenceroom', label: 'Meeting room', group: 'Rooms', support: 'named', note: 'Used for meeting rooms in Places integrations. Link it to a Places room.' },
  { value: 'office', label: 'Office', group: 'Rooms', support: 'named', note: 'Used for closed offices in Places integrations.' },
  { value: 'huddleroom', label: 'Huddle room', group: 'Rooms', support: 'imdf', note: 'Valid IMDF. Places shows it as a plain room.' },
  { value: 'phoneroom', label: 'Phone booth', group: 'Rooms', support: 'imdf', note: 'Valid IMDF. Places shows it as a plain room.' },
  { value: 'restroom', label: 'Restroom', group: 'Facilities', support: 'icon', note: 'Places shows a restroom icon.' },
  { value: 'kitchen', label: 'Kitchen / coffee corner', group: 'Facilities', support: 'named', note: 'IMDF has no coffee category: use this and name the space "Coffee corner". Named by Microsoft ("kitchenettes"); Places shows no kitchen or coffee icon.' },
  { value: 'lounge', label: 'Break-out / lounge', group: 'Facilities', support: 'imdf', note: 'Valid IMDF. Places shows it as a plain room.' },
  { value: 'foodservice', label: 'Canteen / restaurant', group: 'Facilities', support: 'imdf', note: 'Valid IMDF. Places shows it as a plain room.' },
  { value: 'lobby', label: 'Lobby / reception', group: 'Facilities', support: 'imdf', note: 'Valid IMDF. Places shows it as a plain room.' },
  { value: 'storage', label: 'Storage', group: 'Facilities', support: 'imdf', note: 'Valid IMDF. Places shows it as a plain room.' },
  { value: 'serverroom', label: 'Server / IT room', group: 'Facilities', support: 'imdf', note: 'Valid IMDF. Places shows it as a plain room.' },
  { value: 'elevator', label: 'Elevator', group: 'Circulation', support: 'icon', note: 'Places shows an elevator icon.' },
  { value: 'stairs', label: 'Stairs', group: 'Circulation', support: 'icon', note: 'Places shows a stairs icon (shared with escalators).' },
  { value: 'escalator', label: 'Escalator', group: 'Circulation', support: 'icon', note: 'Places shows the same icon as for stairs.' },
  { value: 'walkway', label: 'Corridor / walkway', group: 'Circulation', support: 'named', note: 'Named by Microsoft ("walkways").' },
  { value: 'opentobelow', label: 'Open to below', group: 'Circulation', support: 'imdf', note: 'Valid IMDF (void above a lower floor). Places shows it as a plain polygon.' },
  { value: 'structure', label: 'Wall / structure', group: 'Other', support: 'named', note: 'Named by Microsoft ("walls are closed polygons in the unit file").' },
  { value: 'nonpublic', label: 'Not public', group: 'Other', support: 'named', note: 'Used by Places integrations for spaces that are not bookable or navigable.' },
  { value: 'unspecified', label: 'Unspecified', group: 'Other', support: 'named', note: 'Used for spaces without a clear function.' },
];

export const UNIT_CATEGORIES: readonly string[] = UNIT_CATEGORY_CATALOG.map((c) => c.value);
export const CATEGORY_GROUPS: readonly CategoryGroup[] = ['Rooms', 'Facilities', 'Circulation', 'Other'];

const byValue = new Map(UNIT_CATEGORY_CATALOG.map((c) => [c.value, c]));

export const categoryInfo = (value: string): CategoryInfo | undefined => byValue.get(value);
export const isUnitCategory = (value: string): boolean => byValue.has(value);

/** The category as it goes into the IMDF file: a catalog value, `room` when empty, `unspecified` for anything else. */
export function exportUnitCategory(value: string | undefined): string {
  if (!value) return 'room';
  return byValue.has(value) ? value : 'unspecified';
}
