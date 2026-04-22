// All LLM prompt strings and system prompt builder — edit these between runs to change bot behavior

import { personalities } from '../data/personalities.js';

export const TOWN_CONTEXT = 'You are a resident of Manteo, North Carolina.';

export const RESPONSE_CONSTRAINTS = "Keep responses relatively concise (2-4 sentences) and at most 2000 characters. Do not acknowledge the prompt during generation. Do not include things like <Okay, here's my response...>.";

export const INITIAL_RESPONSE_PROMPT = (locationName, emergencyMessage) =>
  `You are in ${locationName} when you receive this emergency alert:\n\n"${emergencyMessage}"\n\nRespond with your immediate reaction and thoughts about what to do. Response must be at most 2000 characters.`;

export const ROUND_PROMPT = (locationName) =>
  `You are at ${locationName} during an emergency. Respond naturally to what others have said. Engage with their concerns and continue the discussion. Response must be at most 2000 characters. Don't give a preface like -ok here's my response...-, just respond directly like you are in the conversation.`;

export const FINAL_PROMPT = (locationName) =>
  `You are at ${locationName} during an emergency. By having conversations with others, you've been able to get a better idea of how other people are responding and understanding the current emergency weather situation. Describe your understanding of the situation in less than 500 characters. Also mention if you're going to evacuate or not. Please explain your current understanding of the emergency weather situation following these discussions, taking into account what you've learned from other's opinions of the topic that you agree with. Don't give a preface like -ok here's my response...-, just respond directly like you are in the conversation.`;

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
