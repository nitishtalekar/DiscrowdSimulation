// Location presets for coastal NC town simulation
// Based on Manteo, NC and similar Outer Banks communities

export const LOCATION_PRESETS = [
  {
    name: 'The Dockside Diner',
    type: 'commercial',
    capacity: { min: 6, max: 10 },
    description: 'Local breakfast and lunch spot near the marina where locals gather for coffee and conversation',
    emoji: '☕'
  },
  {
    name: 'Oceanfront Park & Pier',
    type: 'public',
    capacity: { min: 8, max: 14 },
    description: 'Central gathering space with pier access, popular with families, dog walkers, and tourists',
    emoji: '🌊'
  },
  {
    name: 'Coastal Community Church',
    type: 'community',
    capacity: { min: 5, max: 9 },
    description: 'Historic church that serves as both worship space and community event center',
    emoji: '⛪'
  },
  {
    name: 'Harbor Marina',
    type: 'commercial',
    capacity: { min: 4, max: 8 },
    description: 'Boat slips, fishing charters, and marine supply store where fishermen and boat owners congregate',
    emoji: '⚓'
  },
  {
    name: 'Main Street General Store',
    type: 'commercial',
    capacity: { min: 7, max: 12 },
    description: 'The main supply hub for groceries, hardware, and essentials - everyone comes here',
    emoji: '🏪'
  },
  {
    name: 'Beachside Library',
    type: 'public',
    capacity: { min: 4, max: 7 },
    description: 'Small quiet town library with meeting rooms, popular with students and retirees',
    emoji: '📚'
  }
];

// Helper function to get a location by name
export function getLocationByName(locationName) {
  return LOCATION_PRESETS.find(loc => loc.name === locationName);
}

// Helper function to get random locations (no duplicates)
export function getRandomLocations(count) {
  if (count > LOCATION_PRESETS.length) {
    throw new Error(`Requested ${count} locations but only ${LOCATION_PRESETS.length} are available`);
  }

  const shuffled = [...LOCATION_PRESETS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Helper function to get total capacity range for a given set of locations
export function getTotalCapacity(locations) {
  return locations.reduce((acc, loc) => ({
    min: acc.min + loc.capacity.min,
    max: acc.max + loc.capacity.max
  }), { min: 0, max: 0 });
}