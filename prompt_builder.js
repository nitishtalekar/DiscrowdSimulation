// Dynamically builds system prompts from resident base properties
import { personalities } from './personalities.js';

const TOWN_CONTEXT = 'You are a resident of Manteo, North Carolina.';
const RESPONSE_CONSTRAINTS = 'Keep responses relatively concise (2-4 sentences) and at most 2000 characters. Do not acknowledge the prompt during generation. Do not include things like <Okay, here\'s my response...>.';

/**
 * Builds a complete LLM system prompt from a resident's base properties.
 * @param {Object} resident
 * @param {string} resident.name
 * @param {string} resident.role
 * @param {string} resident.backstory
 * @param {string} resident.personality  - MBTI code e.g. 'ISFJ'
 * @param {string} [townContext]          - Override the default town setting string
 * @returns {string} Complete system prompt
 */
export function buildSystemPrompt(resident, townContext = TOWN_CONTEXT) {
  const personalityDescription = personalities[resident.personality] ?? '';
  return [
    `You are ${resident.name}.`,
    townContext,
    resident.backstory,
    personalityDescription,
    RESPONSE_CONSTRAINTS,
  ].join(' ');
}
