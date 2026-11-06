/**
 * Copy-paste Places PowerShell commands (issue #53, phase 1). Built in one place so the office page and docs/powershell.md
 * stay consistent. Every command here is documented by Microsoft (MicrosoftPlaces module); nothing is run by the app.
 */

export interface PsStep {
  id: string;
  title: string;
  /** One or two sentences: when to run it, and what role it needs. */
  note: string;
  command: string;
}

export interface PsGroup {
  id: string;
  title: string;
  steps: PsStep[];
}

export const BUILDING_ID_PLACEHOLDER = '<building PlaceId>';

/**
 * A Places id is pasted into a command the user will run, and it comes from an uploaded CSV. Only plain id characters
 * are accepted; anything else falls back to the placeholder so a crafted CSV cannot smuggle code into a command.
 */
export function safePlaceId(id: string | undefined): string {
  return id && /^[A-Za-z0-9._@-]{1,128}$/.test(id) ? id : BUILDING_ID_PLACEHOLDER;
}

/** Single-quoted PowerShell literal; the placeholder stays readable as text to replace. */
function q(value: string): string {
  return value === BUILDING_ID_PLACEHOLDER ? `'${value}'` : `'${value.replace(/'/g, "''")}'`;
}

export function placesCommands(opts: { buildingPlaceId?: string } = {}): PsGroup[] {
  const b = q(safePlaceId(opts.buildingPlaceId));
  return [
    {
      id: 'once',
      title: 'One time per tenant and per computer',
      steps: [
        {
          id: 'install',
          title: 'Install the module and sign in',
          note: 'PowerShell 7.4 or later. Sign in as Places Administrator or Exchange Administrator.',
          command: 'Install-Module -Name MicrosoftPlaces -Force\nConnect-MicrosoftPlaces',
        },
        {
          id: 'enable',
          title: 'Turn on buildings in Places',
          note: 'Needed once per tenant. Without it, Places returns no buildings and no floors.',
          command: "Set-PlacesSettings -EnableBuildings 'Default:true'",
        },
      ],
    },
    {
      id: 'export',
      title: 'Before mapping: get the Places items',
      steps: [
        {
          id: 'list',
          title: 'Find the building',
          note: 'Copy the PlaceId of your building from the output.',
          command: 'Get-PlaceV3 -Type Building | Format-Table DisplayName, PlaceId',
        },
        {
          id: 'export',
          title: 'Export the building and everything in it',
          note: 'Upload places.csv in Places Builder (office page). Only names, types, parents, capacity and floor order are kept.',
          command: `Get-PlaceV3 -AncestorId ${b} | Export-Csv -Path places.csv -NoTypeInformation`,
        },
      ],
    },
    {
      id: 'import',
      title: 'After mapping: put the map into Places',
      steps: [
        {
          id: 'remove',
          title: 'Remove the existing map (only when replacing one)',
          note: 'Skip this for a building without a map. One map per building.',
          command: `Remove-Map -BuildingId ${b}`,
        },
        {
          id: 'new-map',
          title: 'Upload the IMDF zip',
          note: 'The zip already contains the Places IDs. A map can take up to an hour to appear.',
          command: `New-Map -BuildingId ${b} -FilePath '<path to the downloaded zip>'`,
        },
      ],
    },
    {
      id: 'fallback',
      title: 'Fallback: if New-Map rejects the zip',
      steps: [
        {
          id: 'correlate',
          title: 'Correlate with the prepared CSV',
          note: 'Download mapfeatures.csv from Places Builder (already filled in). Then run New-Map with the resulting imdf_correlated.zip.',
          command: "Import-MapCorrelations -MapFilePath '<path to the zip>' -CorrelationsFilePath '<path to mapfeatures.csv>'",
        },
      ],
    },
  ];
}

/** All steps as one script, with comment lines, for docs and a "copy everything" button. */
export function placesScript(opts: { buildingPlaceId?: string } = {}): string {
  return placesCommands(opts)
    .map((g) => `# ${g.title}\n` + g.steps.map((s) => `# ${s.title}\n${s.command}`).join('\n\n'))
    .join('\n\n');
}
