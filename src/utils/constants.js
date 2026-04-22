// Non-prompt constants — model config, Discord message strings, misc lists

export const MODEL = 'gemma3:1b';

export const OLLAMA_BASE_URL = 'http://localhost:11434';

export const EMOJI_LIST = ['😭', '😄', '😌', '🤓', '😎', '😤', '🤖', '😶‍🌫️', '🌏', '📸', '💿', '👋', '🌊', '✨'];

export const DISCORD_MESSAGES = {
  simulationStarting: (locationCount, roundCount) =>
    `⏳ Creating simulation with ${locationCount} locations and ${roundCount} rounds...`,

  alertHeader: (emergencyMessage, locationName) =>
    `🚨 **EMERGENCY ALERT** 🚨\n\n${emergencyMessage}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n**Residents at ${locationName}:**`,

  setupComplete: (summary, threadLinks) =>
    `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Setup complete! Starting emergency response...`,

  afterInitialResponses: (summary, threadLinks, totalBots, statsText) =>
    `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Emergency alert posted to all locations!\n✅ All ${totalBots} residents have responded!\n\n**Current Status:**\n${statsText}\n\n⏳ Starting conversation rounds...`,

  afterRound: (summary, threadLinks, round, roundCount, roundStats, totalMessages) =>
    `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Emergency alert posted!\n✅ Initial responses complete!\n🔄 **Conversation Round ${round}/${roundCount} complete!**\n\n**Current Status:**\n${roundStats}\n\n**Total Messages:** ${totalMessages}\n\n` +
    (round < roundCount ? `⏳ Starting round ${round + 1}...` : `⏳ Beginning Final Round...`),

  finalRoundInProgress: (summary, threadLinks, finalRoundStats, totalMessages) =>
    `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Emergency alert posted!\n✅ Initial responses complete!\n✅ Conversation Round Completed!\n🔄 **Final Round in progress!**\n\n**Current Status:**\n${finalRoundStats}\n\n**Total Messages:** ${totalMessages}\n\n⏳ Finalizing Simulation...`,

  simulationComplete: (summary, threadLinks, finalStats, totalMessages, roundsCompleted, roundCount, totalBots) =>
    `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n🏁 **SIMULATION COMPLETE!** 🏁\n\n**Final Statistics:**\n${finalStats}\n\n**Total Messages:** ${totalMessages}\n**Rounds Completed:** ${roundsCompleted}/${roundCount}\n**Total Residents:** ${totalBots}\n\n✅ All conversations archived in location threads above.\nThank you for running this emergency simulation!`,

  securityError: (errors) =>
    `🚫 **Security Validation Failed**\n\nYour message contains potentially malicious content:\n${errors.map(e => `• ${e}`).join('\n')}\n\nPlease remove any HTML tags, scripts, or special characters and try again.`,

  simulationError: (message) =>
    `❌ **Simulation Error**\n\n${message}\n\nPlease try again or contact support.`,
};
