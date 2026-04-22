// Simulation Engine - Creates and manages town emergency simulations
// Combines location selection, bot allocation, and simulation state

import { getRandomLocations, getTotalCapacity } from './data/locations.js';
import { assignBotsToLocations, validateAssignments } from './utils/bot_allocator.js';
import { TOWN_RESIDENTS } from './data/residents.js';

/**
 * Generate a unique simulation ID
 */
function generateSimulationId() {
  return `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new simulation with bot assignments
 * @param {number} locationCount - Number of locations to include
 * @param {number} roundCount - Number of conversation rounds
 * @param {string} emergencyMessage - The emergency alert message
 * @returns {Object} Simulation object with locations and bot assignments
 */
export function createSimulation(locationCount, roundCount, emergencyMessage) {
  // Generate unique ID
  const simulationId = generateSimulationId();

  // Select random locations (no duplicates)
  const selectedLocations = getRandomLocations(locationCount);

  // Check capacity
  const capacity = getTotalCapacity(selectedLocations);
  const botCount = TOWN_RESIDENTS.length;

  if (botCount > capacity.max) {
    throw new Error(
      `Not enough capacity: ${botCount} bots need ${capacity.min}-${capacity.max} total capacity. ` +
      `Consider using more locations.`
    );
  }

  // Assign bots to locations
  const assignments = assignBotsToLocations(TOWN_RESIDENTS, selectedLocations);

  // Validate assignments
  const validation = validateAssignments(assignments, TOWN_RESIDENTS, selectedLocations);
  if (!validation.valid) {
    throw new Error(`Bot assignment validation failed: ${validation.errors.join(', ')}`);
  }

  // Build simulation object
  const simulation = {
    id: simulationId,
    emergencyMessage: emergencyMessage,
    roundCount: roundCount,
    status: 'created', // Status: created -> running -> complete
    createdAt: Date.now(),
    locations: selectedLocations.map(location => ({
      name: location.name,
      emoji: location.emoji,
      type: location.type,
      capacity: location.capacity,
      description: location.description,
      threadId: null, // Will be filled when thread is created
      bots: assignments[location.name].bots,
      messageCount: 0,
      currentRound: 0,
      transcript: null
    })),
    stats: {
      totalBots: botCount,
      totalLocations: locationCount,
      totalRounds: roundCount,
      messagesPosted: 0,
      roundsCompleted: 0
    }
  };

  return simulation;
}

/**
 * Get simulation statistics
 * @param {Object} simulation - Simulation object
 * @returns {Object} Statistics summary
 */
export function getSimulationStats(simulation) {
  const locationStats = simulation.locations.map(loc => ({
    name: loc.name,
    emoji: loc.emoji,
    botCount: loc.bots.length,
    messageCount: loc.messageCount
  }));

  return {
    totalBots: simulation.stats.totalBots,
    totalLocations: simulation.stats.totalLocations,
    totalRounds: simulation.stats.totalRounds,
    messagesPosted: simulation.stats.messagesPosted,
    roundsCompleted: simulation.stats.roundsCompleted,
    locationBreakdown: locationStats
  };
}

/**
 * Update simulation status
 * @param {Object} simulation - Simulation object
 * @param {string} status - New status (created, running, complete, error)
 */
export function updateSimulationStatus(simulation, status) {
  simulation.status = status;
  if (status === 'complete') {
    simulation.completedAt = Date.now();
  }
}

/**
 * Update thread ID for a location
 * @param {Object} simulation - Simulation object
 * @param {string} locationName - Name of the location
 * @param {string} threadId - Discord thread ID
 */
export function setLocationThreadId(simulation, locationName, threadId) {
  const location = simulation.locations.find(loc => loc.name === locationName);
  if (!location) {
    throw new Error(`Location ${locationName} not found in simulation`);
  }
  location.threadId = threadId;
}

/**
 * Increment message count for a location
 * @param {Object} simulation - Simulation object
 * @param {string} locationName - Name of the location
 * @param {number} count - Number of messages to add (default: 1)
 */
export function incrementMessageCount(simulation, locationName, count = 1) {
  const location = simulation.locations.find(loc => loc.name === locationName);
  if (!location) {
    throw new Error(`Location ${locationName} not found in simulation`);
  }
  location.messageCount += count;
  simulation.stats.messagesPosted += count;
}

/**
 * Update current round for a location
 * @param {Object} simulation - Simulation object
 * @param {string} locationName - Name of the location
 * @param {number} roundNumber - Current round number
 */
export function setLocationRound(simulation, locationName, roundNumber) {
  const location = simulation.locations.find(loc => loc.name === locationName);
  if (!location) {
    throw new Error(`Location ${locationName} not found in simulation`);
  }
  location.currentRound = roundNumber;
}

/**
 * Mark a round as complete
 * @param {Object} simulation - Simulation object
 */
export function completeRound(simulation) {
  simulation.stats.roundsCompleted += 1;
}

/**
 * Get all bots in a specific location
 * @param {Object} simulation - Simulation object
 * @param {string} locationName - Name of the location
 * @returns {Array} Array of bot objects
 */
export function getBotsAtLocation(simulation, locationName) {
  const location = simulation.locations.find(loc => loc.name === locationName);
  if (!location) {
    throw new Error(`Location ${locationName} not found in simulation`);
  }
  return location.bots;
}

/**
 * Get thread ID for a location
 * @param {Object} simulation - Simulation object
 * @param {string} locationName - Name of the location
 * @returns {string|null} Thread ID or null if not set
 */
export function getLocationThreadId(simulation, locationName) {
  const location = simulation.locations.find(loc => loc.name === locationName);
  if (!location) {
    throw new Error(`Location ${locationName} not found in simulation`);
  }
  return location.threadId;
}

/**
 * Format simulation summary for Discord message
 * @param {Object} simulation - Simulation object
 * @returns {string} Formatted summary text
 */
export function formatSimulationSummary(simulation) {
  const locationList = simulation.locations.map(loc =>
    `• ${loc.emoji} **${loc.name}** (${loc.bots.length} residents)`
  ).join('\n');

  return `🚨 **EMERGENCY SIMULATION**\n` +
         `Simulation ID: ${simulation.id}\n\n` +
         `**Emergency:** ${simulation.emergencyMessage.length > 150 ? simulation.emergencyMessage.substring(0, 150) + '...' : simulation.emergencyMessage}\n\n` +
         `**Locations (${simulation.locations.length}):**\n${locationList}\n\n` +
         `**Conversation Rounds:** ${simulation.roundCount}\n` +
         `**Total Residents:** ${simulation.stats.totalBots}\n\n` +
         `⏳ Simulation starting...`;
}

/**
 * Format completion summary for Discord message
 * @param {Object} simulation - Simulation object
 * @returns {string} Formatted completion text
 */
export function formatCompletionSummary(simulation) {
  const locationStats = simulation.locations.map(loc =>
    `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages`
  ).join('\n');

  const duration = simulation.completedAt
    ? Math.round((simulation.completedAt - simulation.createdAt) / 1000)
    : 0;

  const responses = simulation.stats.messagesPosted - simulation.locations.length;

  return `🏁 **SIMULATION COMPLETE**\n\n` +
         `**Emergency:** ${simulation.emergencyMessage.length > 150 ? simulation.emergencyMessage.substring(0, 150) + '...' : simulation.emergencyMessage}\n\n` +
         `**Final Statistics:**\n${locationStats}\n\n` +
         `**Total Messages:** ${responses}\n` +
         `**Rounds Completed:** ${simulation.stats.roundsCompleted}/${simulation.roundCount}\n` +
         `**Duration:** ${duration} seconds`;
}