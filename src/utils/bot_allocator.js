
// Bot Allocator - Weighted Random Assignment Algorithm
// Assigns bots to locations based on personality affinities

import { calculateAffinities } from './affinity_calculator.js';

/**
 * Calculate location weights for a specific bot
 * @param {Object} bot - Bot object with locationAffinities and defaultLocationWeight
 * @param {Array} locations - Array of location objects
 * @returns {Object} Map of location names to weights
 */
export function calculateLocationWeights(bot, locations) {
  const weights = {};

  for (const location of locations) {
    // Check if bot has specific affinity for this location
    const affinity = bot.locationAffinities[location.name];

    // Use affinity if specified, otherwise use default weight
    weights[location.name] = affinity !== undefined ? affinity : bot.defaultLocationWeight;
  }

  return weights;
}

/**
 * Normalize weights to probabilities (sum to 1.0)
 * @param {Object} weights - Map of location names to weights
 * @returns {Object} Map of location names to probabilities
 */
function normalizeToProbabilities(weights) {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);

  if (total === 0) {
    throw new Error('Total weight is zero - cannot normalize');
  }

  const probabilities = {};
  for (const [location, weight] of Object.entries(weights)) {
    probabilities[location] = weight / total;
  }

  return probabilities;
}

/**
 * Select a location based on weighted probabilities
 * @param {Object} probabilities - Map of location names to probabilities
 * @returns {string} Selected location name
 */
function selectLocationByProbability(probabilities) {
  const rand = Math.random();
  let cumulative = 0;

  for (const [location, probability] of Object.entries(probabilities)) {
    cumulative += probability;
    if (rand <= cumulative) {
      return location;
    }
  }

  // Fallback to first location (shouldn't happen with proper probabilities)
  return Object.keys(probabilities)[0];
}

/**
 * Check if a location is at capacity
 * @param {Object} locationAssignments - Current assignments for a location
 * @param {Object} location - Location object with capacity
 * @returns {boolean} True if at max capacity
 */
function isLocationAtCapacity(locationAssignments, location) {
  return locationAssignments.length >= location.capacity.max;
}

/**
 * Greedy assignment algorithm - assigns bots to locations based on weighted probabilities
 * @param {Array} bots - Array of bot objects
 * @param {Array} locations - Array of location objects
 * @returns {Object} Assignment object with locations and their assigned bots
 */
export function assignBotsToLocations(bots, locations) {
  // Initialize assignments structure
  const assignments = {};
  for (const location of locations) {
    assignments[location.name] = {
      location: location,
      bots: [],
      capacity: location.capacity
    };
  }

  // Track available locations (not at capacity)
  let availableLocations = [...locations];

  // Assign each bot
  for (const bot of bots) {
    if (availableLocations.length === 0) {
      throw new Error(`No available locations for bot ${bot.name} - all locations at capacity`);
    }

    // Calculate weights for available locations only
    const { locationAffinities, defaultLocationWeight } = calculateAffinities(bot);
    const enrichedBot = { ...bot, locationAffinities, defaultLocationWeight };
    const weights = calculateLocationWeights(enrichedBot, availableLocations);

    // Convert to probabilities
    const probabilities = normalizeToProbabilities(weights);

    // Select location
    const selectedLocationName = selectLocationByProbability(probabilities);

    // Assign bot to location
    assignments[selectedLocationName].bots.push(bot);

    // Check if location is now at capacity
    const selectedLocation = availableLocations.find(loc => loc.name === selectedLocationName);
    if (isLocationAtCapacity(assignments[selectedLocationName].bots, selectedLocation)) {
      // Remove from available locations
      availableLocations = availableLocations.filter(loc => loc.name !== selectedLocationName);
    }
  }

  return assignments;
}

/**
 * Validate bot assignments
 * @param {Object} assignments - Assignment object from assignBotsToLocations
 * @param {Array} bots - Original bot array
 * @param {Array} locations - Original location array
 * @returns {Object} Validation result { valid: boolean, errors: Array, warnings: Array }
 */
export function validateAssignments(assignments, bots, locations) {
  const errors = [];
  const warnings = [];

  // Check: All bots assigned exactly once
  const assignedBotNames = new Set();
  let totalAssigned = 0;

  for (const [locationName, assignment] of Object.entries(assignments)) {
    for (const bot of assignment.bots) {
      if (assignedBotNames.has(bot.name)) {
        errors.push(`Bot ${bot.name} assigned to multiple locations`);
      }
      assignedBotNames.add(bot.name);
      totalAssigned++;
    }
  }

  if (totalAssigned !== bots.length) {
    errors.push(`Not all bots assigned: ${totalAssigned}/${bots.length}`);
  }

  // Check: Each location within capacity
  for (const [locationName, assignment] of Object.entries(assignments)) {
    const count = assignment.bots.length;
    const { min, max } = assignment.capacity;

    if (count > max) {
      errors.push(`${locationName} over capacity: ${count}/${max}`);
    }

    if (count < min) {
      warnings.push(`${locationName} under minimum: ${count}/${min}`);
    }
  }

  // Check: All locations present in assignments
  for (const location of locations) {
    if (!assignments[location.name]) {
      errors.push(`Location ${location.name} missing from assignments`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Print assignment summary (for debugging/testing)
 * @param {Object} assignments - Assignment object
 */
export function printAssignmentSummary(assignments) {
  console.log('\n========== ASSIGNMENT SUMMARY ==========\n');

  for (const [locationName, assignment] of Object.entries(assignments)) {
    const { min, max } = assignment.capacity;
    const count = assignment.bots.length;
    const status = count >= min && count <= max ? '✓' : '⚠';

    console.log(`${status} ${assignment.location.emoji} ${locationName}`);
    console.log(`   Capacity: ${count}/${min}-${max}`);
    console.log(`   Residents:`);

    for (const bot of assignment.bots) {
      console.log(`     ${bot.emoji} ${bot.name} (${bot.role})`);
    }
    console.log('');
  }

  // Total summary
  const totalBots = Object.values(assignments).reduce((sum, a) => sum + a.bots.length, 0);
  console.log(`Total bots assigned: ${totalBots}`);
  console.log('========================================\n');
}

/**
 * Get assignment statistics
 * @param {Object} assignments - Assignment object
 * @returns {Object} Statistics object
 */
export function getAssignmentStats(assignments) {
  const stats = {
    totalBots: 0,
    locationCounts: {},
    avgBotsPerLocation: 0,
    minBots: Infinity,
    maxBots: 0
  };

  for (const [locationName, assignment] of Object.entries(assignments)) {
    const count = assignment.bots.length;
    stats.totalBots += count;
    stats.locationCounts[locationName] = count;
    stats.minBots = Math.min(stats.minBots, count);
    stats.maxBots = Math.max(stats.maxBots, count);
  }

  stats.avgBotsPerLocation = stats.totalBots / Object.keys(assignments).length;

  return stats;
}
