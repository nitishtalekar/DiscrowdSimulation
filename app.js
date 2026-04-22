import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { getRandomEmoji, DiscordRequest } from './utils.js';
import {
  createSimulation,
  formatSimulationSummary,
  setLocationThreadId,
  updateSimulationStatus,
  incrementMessageCount,
  getSimulationStats,
  completeRound,
  setLocationRound,
  formatCompletionSummary
} from './simulation_engine.js';
import { buildSystemPrompt } from './prompt_builder.js';
import { ChatOllama } from '@langchain/community/chat_models/ollama';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import fs from 'fs/promises';

// Ollama model
const MODEL = 'gemma3:1b';
// Sliding window size for conversation context passed to the LLM
const CONTEXT_WINDOW_SIZE = parseInt(process.env.CONTEXT_WINDOW_SIZE ?? '10', 10);

// LangChain Ollama client
const ollamaClient = new ChatOllama({
  baseUrl: 'http://localhost:11434',
  model: MODEL,
});

// Round Response prompt
const ROUND_PROMPT = `Respond naturally to what others have said. Engage with their concerns and continue the discussion. Response must be at most 2000 characters. Don't give a preface like -ok here's my response...-, just respond directly like you are in the conversation.`;
// Final Response prompt
const FINAL_PROMPT = `By having conversations with others, you've been able to get a better idea of how other people are responding and understanding the current emergency weather situation. Describe your understanding of the situation in less than 500 characters. Also mention if you're going to evacuate or not. Please explain your current understanding of the emergency weather situation following these discussions, taking into account what you've learned from other's opinions of the topic that you agree with. Don't give a preface like -ok here's my response...-, just respond directly like you are in the conversation.`;

// Helper function: Check for XSS and injection attempts
function validateMessageSecurity(message) {
  const errors = [];
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('<script') || lowerMessage.includes('</script>')) {
    errors.push('Message contains script tags');
  }

  const eventHandlers = ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'];
  for (const handler of eventHandlers) {
    if (lowerMessage.includes(handler)) {
      errors.push('Message contains event handlers');
      break;
    }
  }

  if (lowerMessage.includes('javascript:')) {
    errors.push('Message contains javascript protocol');
  }

  if (lowerMessage.includes('<iframe') || lowerMessage.includes('<embed') || lowerMessage.includes('<object')) {
    errors.push('Message contains potentially malicious HTML tags');
  }

  const sqlPatterns = ['drop table', 'delete from', 'insert into', 'update set', '1=1', '1\'=\'1'];
  for (const pattern of sqlPatterns) {
    if (lowerMessage.includes(pattern)) {
      errors.push('Message contains SQL-like injection patterns');
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

async function createMyFolder(folderPath) {
  try {
    await fs.mkdir(folderPath, { recursive: true });
    console.log(`Directory created successfully at: ${folderPath}`);
  } catch (err) {
    console.error('An error occurred:', err);
  }
}

async function createFileAsync(filename, content) {
  try {
    await fs.writeFile(filename, content);
    console.log(`File "${filename}" created successfully`);
  } catch (err) {
    console.error('Error writing file:', err);
  }
}

// Helper to update the main message - silently skips if the token has expired (15 min limit)
async function safeUpdateMessage(endpoint, content) {
  try {
    await DiscordRequest(endpoint, { method: 'PATCH', body: { content } });
  } catch (err) {
    console.warn('Could not update main message (token may have expired):', err.message);
  }
}

/**
 * Builds a LangChain message array from a shared conversation history.
 * Applies a sliding window of the last `windowSize` messages before adding the current prompt.
 * @param {string} systemPromptText - The bot's system prompt
 * @param {Array<{role, name, content}>} convHistory - Shared location conversation history
 * @param {number} windowSize - Max number of history messages to include
 * @param {string} currentPrompt - The prompt for this specific round
 * @returns {Array} LangChain message array
 */
function buildLangChainMessages(systemPromptText, convHistory, windowSize, currentPrompt) {
  const windowed = convHistory.slice(-windowSize);
  const messages = [new SystemMessage(systemPromptText)];

  for (const msg of windowed) {
    if (msg.role === 'user') {
      messages.push(new HumanMessage(`${msg.name}: ${msg.content}`));
    } else {
      messages.push(new AIMessage(`${msg.name}: ${msg.content}`));
    }
  }

  messages.push(new HumanMessage(currentPrompt));
  return messages;
}

// Store active simulations
const activeSimulations = new Map();
// Structured conversation history per simulation per location
// Map<simulationId, Map<locationName, Array<{role, name, content}>>>
const locationConversations = new Map();

// Create an express app
const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { id, type, data } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    // "test" command
    if (name === 'test') {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              content: `hello world ${getRandomEmoji()}`
            }
          ]
        },
      });
    }

    // "simulate" command - captures location/round counts, then opens modal for message
    if (name === 'simulate') {
      const locationCount = data.options.find(opt => opt.name === 'locations').value;
      const roundCount = data.options.find(opt => opt.name === 'rounds').value;

      return res.send({
        type: InteractionResponseType.MODAL,
        data: {
          custom_id: `simulation_modal_${locationCount}_${roundCount}`,
          title: 'Emergency Message',
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'emergency_message',
                  label: 'What emergency is happening?',
                  style: 2,
                  placeholder: 'Example: Hurricane Category 4 approaching coast. Mandatory evacuation in effect.',
                  min_length: 1,
                  max_length: 2000,
                  required: true,
                },
              ],
            },
          ],
        },
      });
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  /**
   * Handle modal submissions
   */
  if (type === InteractionType.MODAL_SUBMIT) {
    const { custom_id, components } = req.body.data;

    if (custom_id.startsWith('simulation_modal_')) {
      const channelId = req.body.channel_id;

      const parts = custom_id.split('_');
      const locationCount = parseInt(parts[2], 10);
      const roundCount = parseInt(parts[3], 10);

      const emergencyMessage = components[0].components[0].value;

      const securityCheck = validateMessageSecurity(emergencyMessage);
      if (!securityCheck.valid) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `🚫 **Security Validation Failed**\n\nYour message contains potentially malicious content:\n${securityCheck.errors.map(e => `• ${e}`).join('\n')}\n\nPlease remove any HTML tags, scripts, or special characters and try again.`,
            flags: 64,
          },
        });
      }

      res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `⏳ Creating simulation with ${locationCount} locations and ${roundCount} rounds...`,
        },
      });

      try {
        const simulation = createSimulation(locationCount, roundCount, emergencyMessage);
        console.log(`Created simulation: ${simulation.id}`);

        activeSimulations.set(simulation.id, simulation);

        // Initialize per-location conversation history
        locationConversations.set(simulation.id, new Map());
        for (const location of simulation.locations) {
          locationConversations.get(simulation.id).set(location.name, []);
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        const getMessageEndpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`;
        const messageResponse = await DiscordRequest(getMessageEndpoint, { method: 'GET' });
        const messageData = await messageResponse.json();

        if (!messageData || !messageData.id) {
          throw new Error('Failed to get message ID');
        }

        // Create a thread for each location
        for (const location of simulation.locations) {
          try {
            const threadName = `${location.emoji} ${location.name} (${location.bots.length} residents)`;
            const threadEndpoint = `channels/${channelId}/threads`;
            const threadResponse = await DiscordRequest(threadEndpoint, {
              method: 'POST',
              body: {
                name: threadName.substring(0, 100),
                type: 11,
                auto_archive_duration: 1440,
              },
            });

            const threadData = await threadResponse.json();
            setLocationThreadId(simulation, location.name, threadData.id);
            console.log(`Created thread for ${location.name}: ${threadData.id}`);
          } catch (threadErr) {
            console.error(`Error creating thread for ${location.name}:`, threadErr);
            throw threadErr;
          }
        }

        updateSimulationStatus(simulation, 'ready');

        const summary = formatSimulationSummary(simulation);
        const threadLinks = simulation.locations.map(loc =>
          `• <#${loc.threadId}> - ${loc.bots.length} residents`
        ).join('\n');

        await safeUpdateMessage(
          getMessageEndpoint,
          `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Setup complete! Starting emergency response...`
        );

        console.log(`Simulation ${simulation.id} setup complete`);

        createMyFolder(`./Transcripts/${simulation.id}`);

        console.log(`Beginning Simulation: Emergency alert and initial responses`);
        updateSimulationStatus(simulation, 'running');

        // ===== PHASE 1: INITIAL RESPONSES =====

        for (const location of simulation.locations) {
          const threadId = location.threadId;
          const bots = location.bots;
          const convHistory = locationConversations.get(simulation.id).get(location.name);

          console.log(`Processing location: ${location.name} (${bots.length} bots)`);

          try {
            const alertEndpoint = `channels/${threadId}/messages`;
            await DiscordRequest(alertEndpoint, {
              method: 'POST',
              body: {
                content: `🚨 **EMERGENCY ALERT** 🚨\n\n${emergencyMessage}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n**Residents at ${location.name}:**`,
              },
            });

            // Seed conversation history with the emergency alert
            convHistory.push({ role: 'user', name: 'EMERGENCY ALERT', content: emergencyMessage });
            incrementMessageCount(simulation, location.name, 1);
            console.log(`Posted emergency alert to ${location.name}`);

            await new Promise(resolve => setTimeout(resolve, 250));

            for (const bot of bots) {
              try {
                const systemPrompt = buildSystemPrompt(bot);
                const currentPrompt = `You are in ${location.name} when you receive this emergency alert:\n\n"${emergencyMessage}"\n\nRespond with your immediate reaction and thoughts about what to do. Response must be at most 2000 characters.`;
                const messages = buildLangChainMessages(systemPrompt, convHistory, CONTEXT_WINDOW_SIZE, currentPrompt);

                const llmResponse = await ollamaClient.invoke(messages);
                const responseText = llmResponse.content || 'No response';

                await DiscordRequest(alertEndpoint, {
                  method: 'POST',
                  body: { content: `**${bot.emoji} ${bot.name}**\n${responseText}` },
                });

                convHistory.push({ role: 'assistant', name: bot.name, content: responseText });
                incrementMessageCount(simulation, location.name, 1);
                console.log(`  ✓ ${bot.name} responded`);

                await new Promise(resolve => setTimeout(resolve, 300));
              } catch (botErr) {
                console.error(`  ✗ Error with ${bot.name}:`, botErr.message);
                await DiscordRequest(alertEndpoint, {
                  method: 'POST',
                  body: { content: `**${bot.emoji} ${bot.name}**\n_[Unable to respond]_` },
                });
              }
            }

            console.log(`✓ Completed initial responses for ${location.name}`);
          } catch (locationErr) {
            console.error(`Error processing location ${location.name}:`, locationErr);
          }
        }

        const stats = getSimulationStats(simulation);
        const statsText = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages`
        ).join('\n');

        await safeUpdateMessage(
          getMessageEndpoint,
          `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Emergency alert posted to all locations!\n✅ All ${stats.totalBots} residents have responded!\n\n**Current Status:**\n${statsText}\n\n⏳ Starting conversation rounds...`
        );

        const responses = simulation.stats.messagesPosted - simulation.locations.length;
        console.log(`Initial Responses complete! Total messages: ${responses}`);

        // ===== PHASE 2: CONVERSATION ROUNDS =====

        console.log(`Starting Conversation rounds (${roundCount} rounds)`);

        for (let round = 1; round <= roundCount; round++) {
          console.log(`\n=== ROUND ${round}/${roundCount} ===`);

          for (const location of simulation.locations) {
            const threadId = location.threadId;
            const bots = location.bots;
            const convHistory = locationConversations.get(simulation.id).get(location.name);

            console.log(`Round ${round} at ${location.name}...`);

            try {
              await new Promise(resolve => setTimeout(resolve, 250));

              for (const bot of bots) {
                try {
                  const systemPrompt = buildSystemPrompt(bot);
                  const currentPrompt = `You are at ${location.name} during an emergency. ${ROUND_PROMPT}`;
                  const messages = buildLangChainMessages(systemPrompt, convHistory, CONTEXT_WINDOW_SIZE, currentPrompt);

                  const llmResponse = await ollamaClient.invoke(messages);
                  const responseText = llmResponse.content || 'No response';

                  const messageEndpoint = `channels/${threadId}/messages`;
                  await DiscordRequest(messageEndpoint, {
                    method: 'POST',
                    body: { content: `**${bot.emoji} ${bot.name}**\n${responseText}` },
                  });

                  convHistory.push({ role: 'assistant', name: bot.name, content: responseText });
                  incrementMessageCount(simulation, location.name, 1);
                  console.log(`  ✓ ${bot.name} (Round ${round})`);

                  await new Promise(resolve => setTimeout(resolve, 300));
                } catch (botErr) {
                  console.error(`  ✗ Error with ${bot.name} in round ${round}:`, botErr.message);
                }
              }

              setLocationRound(simulation, location.name, round);
              console.log(`✓ Completed round ${round} at ${location.name}`);
            } catch (locationErr) {
              console.error(`Error in round ${round} at ${location.name}:`, locationErr);
            }
          }

          completeRound(simulation);

          const roundStats = simulation.locations.map(loc =>
            `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages (Round ${loc.currentRound}/${roundCount})`
          ).join('\n');

          await safeUpdateMessage(
            getMessageEndpoint,
            `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Emergency alert posted!\n✅ Initial responses complete!\n🔄 **Conversation Round ${round}/${roundCount} complete!**\n\n**Current Status:**\n${roundStats}\n\n**Total Messages:** ${simulation.stats.messagesPosted}\n\n` +
            (round < roundCount ? `⏳ Starting round ${round + 1}...` : `⏳ Beginning Final Round...`)
          );

          console.log(`✓ Round ${round}/${roundCount} complete! Total messages: ${simulation.stats.messagesPosted}`);

          if (round < roundCount) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        // ===== PHASE 3: FINAL ROUND =====

        console.log(`\n==Starting Final Round==`);

        for (const location of simulation.locations) {
          const threadId = location.threadId;
          const bots = location.bots;
          const convHistory = locationConversations.get(simulation.id).get(location.name);

          console.log(`Final Response at ${location.name}...`);

          try {
            await new Promise(resolve => setTimeout(resolve, 250));

            for (const bot of bots) {
              try {
                const systemPrompt = buildSystemPrompt(bot);
                const currentPrompt = `You are at ${location.name} during an emergency. ${FINAL_PROMPT}`;
                const messages = buildLangChainMessages(systemPrompt, convHistory, CONTEXT_WINDOW_SIZE, currentPrompt);

                const llmResponse = await ollamaClient.invoke(messages);
                const responseText = llmResponse.content || 'No response';

                const messageEndpoint = `channels/${threadId}/messages`;
                await DiscordRequest(messageEndpoint, {
                  method: 'POST',
                  body: { content: `**${bot.emoji} ${bot.name}**\n${responseText}` },
                });

                convHistory.push({ role: 'assistant', name: bot.name, content: responseText });
                incrementMessageCount(simulation, location.name, 1);
                console.log(`  ✓ ${bot.name} (Final Round)`);

                await new Promise(resolve => setTimeout(resolve, 300));
              } catch (botErr) {
                console.error(`  ✗ Error with ${bot.name} in final round:`, botErr.message);
              }
            }

            console.log(`✓ Completed Final Round at ${location.name}`);

            // Write structured JSON transcript
            const transcriptData = {
              simulationId: simulation.id,
              location: location.name,
              emergencyMessage: simulation.emergencyMessage,
              messages: convHistory,
            };
            createFileAsync(
              `./Transcripts/${simulation.id}/${location.name}.json`,
              JSON.stringify(transcriptData, null, 2)
            );
          } catch (locationErr) {
            console.error(`Error in Final Round at ${location.name}:`, locationErr);
          }
        }

        const finalRoundStats = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages (Final Round)`
        ).join('\n');

        await safeUpdateMessage(
          getMessageEndpoint,
          `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n✅ Emergency alert posted!\n✅ Initial responses complete!\n✅ Conversation Round Completed!\n🔄 **Final Round in progress!**\n\n**Current Status:**\n${finalRoundStats}\n\n**Total Messages:** ${simulation.stats.messagesPosted}\n\n⏳ Finalizing Simulation...`
        );

        console.log(`✓ Final Round complete! Total messages: ${simulation.stats.messagesPosted}`);

        // ===== SIMULATION COMPLETE =====

        console.log(`\nAll rounds complete! Finalizing simulation...`);
        updateSimulationStatus(simulation, 'complete');

        const finalStats = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages`
        ).join('\n');

        await safeUpdateMessage(
          getMessageEndpoint,
          `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n🏁 **SIMULATION COMPLETE!** 🏁\n\n**Final Statistics:**\n${finalStats}\n\n**Total Messages:** ${simulation.stats.messagesPosted}\n**Rounds Completed:** ${simulation.stats.roundsCompleted}/${roundCount}\n**Total Residents:** ${simulation.stats.totalBots}\n\n✅ All conversations archived in location threads above.\nThank you for running this emergency simulation!`
        );

        // Clean up in-memory conversation store
        locationConversations.delete(simulation.id);

        console.log(`🏁 Simulation ${simulation.id} complete!`);
        console.log(`   Total messages: ${simulation.stats.messagesPosted}`);
        console.log(`   Rounds: ${simulation.stats.roundsCompleted}/${roundCount}`);
        console.log(`   Status: ${simulation.status}`);

      } catch (err) {
        console.error('Simulation creation error:', err);

        const getMessageEndpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`;
        await DiscordRequest(getMessageEndpoint, {
          method: 'PATCH',
          body: {
            content: `❌ **Simulation Error**\n\n${err.message}\n\nPlease try again or contact support.`,
          },
        });
      }

      return;
    }
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
