// Rule-based location affinity calculator
// Maps resident roles to weighted location preferences

const HIGH = 0.7;
const MID = 0.5;
const LOW = 0.4;
const DEFAULT = 0.25;

const ROLE_AFFINITIES = {
  elderly_disabled:     { 'Beachside Library': HIGH, 'Coastal Community Church': MID, 'Main Street General Store': LOW },
  elderly:              { 'Coastal Community Church': HIGH, 'Beachside Library': MID, 'Main Street General Store': LOW },
  family_caregiver:     { 'Coastal Community Church': HIGH, 'Beachside Library': MID, 'Main Street General Store': LOW },
  medical_dependent:    { 'Main Street General Store': HIGH, 'Coastal Community Church': MID, 'Beachside Library': LOW },
  limited_mobility:     { 'Beachside Library': HIGH, 'Main Street General Store': MID, 'Coastal Community Church': LOW },
  homeless:             { 'Coastal Community Church': HIGH, 'Oceanfront Park & Pier': MID, 'Main Street General Store': LOW },
  outskirts_resident:   { 'Main Street General Store': HIGH, 'Oceanfront Park & Pier': MID, 'The Dockside Diner': LOW },
  student:              { 'Beachside Library': HIGH, 'Main Street General Store': MID, 'The Dockside Diner': LOW },
  spanish_speaker:      { 'Coastal Community Church': HIGH, 'Main Street General Store': MID, 'Oceanfront Park & Pier': LOW },
  mandarin_speaker:     { 'Beachside Library': HIGH, 'Main Street General Store': MID, 'Oceanfront Park & Pier': LOW },
  established_resident: { 'The Dockside Diner': HIGH, 'Main Street General Store': MID, 'Coastal Community Church': LOW },
  parent:               { 'Oceanfront Park & Pier': HIGH, 'Main Street General Store': MID, 'The Dockside Diner': LOW },
  young_resident:       { 'The Dockside Diner': HIGH, 'Oceanfront Park & Pier': MID, 'Main Street General Store': LOW },
  storm_skeptic:        { 'The Dockside Diner': HIGH, 'Harbor Marina': MID, 'Main Street General Store': LOW },
  conspiracy_theorist:  { 'Harbor Marina': HIGH, 'The Dockside Diner': MID, 'Main Street General Store': LOW },
  protective_homeowner: { 'Main Street General Store': HIGH, 'Harbor Marina': MID, 'The Dockside Diner': LOW },
};

/**
 * Returns locationAffinities and defaultLocationWeight for a resident based on their role.
 * @param {Object} resident - must have a .role string matching a key in ROLE_AFFINITIES
 * @returns {{ locationAffinities: Object, defaultLocationWeight: number }}
 */
export function calculateAffinities(resident) {
  return {
    locationAffinities: ROLE_AFFINITIES[resident.role] ?? {},
    defaultLocationWeight: DEFAULT,
  };
}
