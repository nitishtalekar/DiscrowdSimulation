// All LLM prompt strings and system prompt builder — edit these between runs to change bot behavior

import { personalities } from '../data/personalities.js';

export const INITIAL_EXTRA = (emergencyMessage) =>
  `An emergency alert has just been announced: "${emergencyMessage}".Get into the conversation, or start the conversation based on your initial reaction to the alert.`;

export const FINAL_EXTRA =
  `This is the end of the conversation. Say what you've taken away from it — speak directly to the others. At the end of your response include your final evacuation decision: <<YES>> or <<NO>>.`;

export function buildSystemPrompt(resident, locationName, extraInstruction = '') {
  const personalityDescription = personalities[resident.personality] ?? '';
  const roleLabel = resident.role.replace(/_/g, ' ');

  const parts = [
    `You are ${resident.name}, a ${roleLabel}.`,
    `You are in a conversation with other residents at ${locationName} during an emergency.`,
    `You will respond to the other characters based on your personality.`,
    `ALWAYS respond like you are talking to the people around you. DO NOT GREET EVERY TIME.`,
    personalityDescription,
    `This is your backstory: ${resident.backstory}.`,
    `Respond as part of a natural conversation. DO NOT ADD ACTIONS OR STAGE DIRECTIONS. DO NOT SAY "I THINK" OR "I FEEL". JUST SAY WHAT YOU THINK AND FEEL AS IF YOU ARE TALKING TO THE OTHER RESIDENTS. SPEAK ONLY AS YOURSELF AND REPOND ONLY IN TEXT RESPONSE. MAKE SURE YOUR RESPONSES ARE SHORT AS PART OF A CONVERSATION AND NOT LONG MONOLOGUES.`,
  ];

  if (extraInstruction) {
    parts.push(extraInstruction);
  }

  return parts.join(' ');
}
