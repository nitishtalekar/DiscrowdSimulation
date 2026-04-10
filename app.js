import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
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
import fs from 'fs/promises';

// Ollama model
const MODEL = "gemma3:1b";
// Round Response prompt
const ROUND_PROMPT = `Respond naturally to what others have said. Engage with their concerns and continue the discussion. Response must be at most 2000 characters. Dont give a preface like -ok heres my response...-, just respond directly like you are in the conversation.`;
// Final Response prompt
const FINAL_PROMPT = `By having conversations with others, you’ve been able to get a better idea of how other people are responding and understanding the current emergency weather situation. Describe your understanding of the situation in less than 500 characters. Also mention if you're going to evacuate or not. Please explain your current understanding of the emergency weather situation following these discussions, taking into account what you’ve learned from other’s opinions of the topic that you agree with. Dont give a preface like -ok heres my response...-, just respond directly like you are in the conversation.`
// localhost endpoint for sending messages
const LOCAL_ENDPOINT = 'http://localhost:11434/api/generate';

// Helper function: Check for XSS and injection attempts
function validateMessageSecurity(message) {
  const errors = [];
  const lowerMessage = message.toLowerCase();

  // Check for script tags
  if (lowerMessage.includes('<script') || lowerMessage.includes('</script>')) {
    errors.push('Message contains script tags');
  }

  // Check for event handlers
  const eventHandlers = ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'];
  for (const handler of eventHandlers) {
    if (lowerMessage.includes(handler)) {
      errors.push('Message contains event handlers');
      break;
    }
  }

  // Check for javascript: protocol
  if (lowerMessage.includes('javascript:')) {
    errors.push('Message contains javascript protocol');
  }

  // Check for common XSS patterns
  if (lowerMessage.includes('<iframe') || lowerMessage.includes('<embed') || lowerMessage.includes('<object')) {
    errors.push('Message contains potentially malicious HTML tags');
  }

  // Check for SQL injection patterns
  const sqlPatterns = ['drop table', 'delete from', 'insert into', 'update set', '1=1', '1\'=\'1'];
  for (const pattern of sqlPatterns) {
    if (lowerMessage.includes(pattern)) {
      errors.push('Message contains SQL-like injection patterns');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}


async function createMyFolder(folderPath) {
  try {
    await fs.mkdir(folderPath, { recursive: true });
    console.log(`Directory created successfully at: ${folderPath}`);
  } catch (err) {
    // Handle errors, though with 'recursive: true', most mkdir errors are avoided
    console.error('An error occurred:', err);
  }
}

async function createFileAsync(filename, content) {
  try {
    await fs.writeFile(filename, content); // This line pauses the function until the file is written
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

// Store active simulations
const activeSimulations = new Map();

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of our active games
const activeGames = {};

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    // "test" command
    if (name === 'test') {
      // Send a message into the channel where command was triggered from
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              // Fetches a random emoji to send from a helper function
              content: `hello world ${getRandomEmoji()}`
            }
          ]
        },
      });
    }

    // "simulate" command - captures location/round counts, then opens modal for message
    if (name === 'simulate') {
      // Get the location count and round count from command options
      const locationCount = data.options.find(opt => opt.name === 'locations').value;
      const roundCount = data.options.find(opt => opt.name === 'rounds').value;

      // Open modal for emergency message
      // We'll include location/round counts in custom_id so we can retrieve them later
      return res.send({
        type: InteractionResponseType.MODAL,
        data: {
          custom_id: `simulation_modal_${locationCount}_${roundCount}`,
          title: 'Emergency Message',
          components: [
            {
              type: 1, // Action Row
              components: [
                {
                  type: 4, // Text Input
                  custom_id: 'emergency_message',
                  label: 'What emergency is happening?',
                  style: 2, // Paragraph
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

    // Check if this is our simulation modal
    if (custom_id.startsWith('simulation_modal_')) {
      const channelId = req.body.channel_id;

      // Parse location and round counts from custom_id
      const parts = custom_id.split('_');
      const locationCount = parseInt(parts[2], 10);
      const roundCount = parseInt(parts[3], 10);

      // Extract emergency message
      const emergencyMessage = components[0].components[0].value;

      // Security validation - check for XSS and injection
      const securityCheck = validateMessageSecurity(emergencyMessage);

      if (!securityCheck.valid) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `🚫 **Security Validation Failed**\n\nYour message contains potentially malicious content:\n${securityCheck.errors.map(e => `• ${e}`).join('\n')}\n\nPlease remove any HTML tags, scripts, or special characters and try again.`,
            flags: 64, // Ephemeral
          },
        });
      }

      // Send initial acknowledgment
      res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `⏳ Creating simulation with ${locationCount} locations and ${roundCount} rounds...`,
        },
      });

      try {
        // Create simulation structure
        const simulation = createSimulation(locationCount, roundCount, emergencyMessage);
        console.log(`Created simulation: ${simulation.id}`);

        // Store simulation for later phases
        activeSimulations.set(simulation.id, simulation);

        // Wait a moment for Discord to process the initial message
        await new Promise(resolve => setTimeout(resolve, 500));


        // Get the message ID so we can create threads from it
        const getMessageEndpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`;
        const messageResponse = await DiscordRequest(getMessageEndpoint, { method: 'GET' });
        const messageData = await messageResponse.json();

        if (!messageData || !messageData.id) {
          throw new Error('Failed to get message ID');
        }

        const mainMessageId = messageData.id;

        // Create a thread for each location
        for (const location of simulation.locations) {
          try {
            const threadName = `${location.emoji} ${location.name} (${location.bots.length} residents)`;

            // Create thread endpoint
            const threadEndpoint = `channels/${channelId}/threads`;
            const threadResponse = await DiscordRequest(threadEndpoint, {
              method: 'POST',
              body: {
                name: threadName.substring(0, 100), // Discord limit: 100 chars
                type: 11, // Public thread
                auto_archive_duration: 1440, // Archive after 24 hours
              },
            });

            const threadData = await threadResponse.json();

            // Store thread ID in simulation
            setLocationThreadId(simulation, location.name, threadData.id);

            console.log(`Created thread for ${location.name}: ${threadData.id}`);

          } catch (threadErr) {
            console.error(`Error creating thread for ${location.name}:`, threadErr);
            throw threadErr;
          }
        }

        // Update simulation status
        updateSimulationStatus(simulation, 'ready');

        // Update the main message with summary and thread links
        const summary = formatSimulationSummary(simulation);

        // Build thread links
        const threadLinks = simulation.locations.map(loc =>
          `• <#${loc.threadId}> - ${loc.bots.length} residents`
        ).join('\n');

        let finalMessage = `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n` +
                            `✅ Setup complete! Starting emergency response...`;

        await safeUpdateMessage(getMessageEndpoint, finalMessage);

        console.log(`Simulation ${simulation.id} setup complete`);

        // create folder for simulation transcript
        createMyFolder(`./Transcripts/${simulation.id}`);

        console.log(`Beginning Simulation: Emergency alert and initial responses`);

        // Update simulation status
        updateSimulationStatus(simulation, 'running');

        // Post emergency alert and get initial responses for each location
        for (const location of simulation.locations) {
          const threadId = location.threadId;
          const bots = location.bots;

          console.log(`Processing location: ${location.name} (${bots.length} bots)`);

          try {
            // Post emergency alert to thread
            const alertEndpoint = `channels/${threadId}/messages`;
            await DiscordRequest(alertEndpoint, {
              method: 'POST',
              body: {
                content: `🚨 **EMERGENCY ALERT** 🚨\n\n${emergencyMessage}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n**Residents at ${location.name}:**`,
              },
            });

            location.transcript = `=====Transcript Begin=====\n🚨 EMERGENCY ALERT 🚨: ${emergencyMessage}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=====Initial Response=====\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;

            incrementMessageCount(simulation, location.name, 1);
            console.log(`Posted emergency alert to ${location.name}`);

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 250));

            // Have each bot respond to the emergency
            for (const bot of bots) {
              try {
                // Build prompt for bot's initial reaction
                const botPrompt = `You are in ${location.name} when you receive this emergency alert:\n\n"${emergencyMessage}"\n\nRespond with your immediate reaction and thoughts about what to do. Response must be at most 2000 characters.`;

                // Call Ollama
                const ollamaResponse = await fetch(LOCAL_ENDPOINT, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: MODEL,
                    prompt: botPrompt,
                    system: bot.systemPrompt,
                    stream: false,
                  }),
                });

                const ollamaData = await ollamaResponse.json();
                const responseText = ollamaData.response || 'No response';

                // Post bot's response to thread
                await DiscordRequest(alertEndpoint, {
                  method: 'POST',
                  body: {
                    content: `**${bot.emoji} ${bot.name}**\n${responseText}`,
                  },
                });

                location.transcript = location.transcript + `^* Name:${bot.name} Personality:${bot.personalityCode}\n${responseText} *^\n\n`;
                incrementMessageCount(simulation, location.name, 1);
                console.log(`  ✓ ${bot.name} responded`);

                // Small delay between bot responses to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 300));

              } catch (botErr) {
                console.error(`  ✗ Error with ${bot.name}:`, botErr.message);
                // Post error message so we can see what happened
                await DiscordRequest(alertEndpoint, {
                  method: 'POST',
                  body: {
                    content: `**${bot.emoji} ${bot.name}**\n_[Unable to respond]_`,
                  },
                });
              }
            }

            console.log(`✓ Completed initial responses for ${location.name}`);

          } catch (locationErr) {
            console.error(`Error processing location ${location.name}:`, locationErr);
          }
          location.transcript = location.transcript + '\n=====End Initial Response=====';
        }

        // Update main message with initial response completion
        const stats = getSimulationStats(simulation);
        const statsText = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages`
        ).join('\n');

        const initialResponseCompleteMessage = `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n` +
                                     `✅ Emergency alert posted to all locations!\n` +
                                     `✅ All ${stats.totalBots} residents have responded!\n\n` +
                                     `**Current Status:**\n${statsText}\n\n` +
                                     `⏳ Starting conversation rounds...`;

        await safeUpdateMessage(getMessageEndpoint, initialResponseCompleteMessage);

        const responses = simulation.stats.messagesPosted - simulation.locations.length;

        console.log(`Initial Responses complete! Total messages: ${responses}`);


        // ===== CONVERSATION ROUNDS =====

        console.log(`Starting Conversation rounds (${roundCount} rounds)`);

        // Run conversation rounds
        for (let round = 1; round <= roundCount; round++) {
          console.log(`\n=== ROUND ${round}/${roundCount} ===`);

          // Process each location in this round
          for (const location of simulation.locations) {
            const threadId = location.threadId;
            const bots = location.bots;

            console.log(`Round ${round} at ${location.name}...`);
            location.transcript = location.transcript + `\n\n=====Round Responses=====\n\nRound ${round}\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;

            try {
              // Fetch recent messages from this thread to build context
              const messagesEndpoint = `channels/${threadId}/messages?limit=20`;
              const messagesResponse = await DiscordRequest(messagesEndpoint, { method: 'GET' });
              const messages = await messagesResponse.json();

              // Reverse so oldest first
              const recentMessages = messages.reverse();

              // Build conversation context (last 10 messages)
              const contextMessages = recentMessages.slice(-10);
              const conversationContext = contextMessages
                .map(msg => {
                  // Extract bot name and message
                  const content = msg.content;
                  if (content.includes('**') && !content.includes('EMERGENCY ALERT')) {
                    return content;
                  }
                  return null;
                })
                .filter(Boolean)
                .join('\n\n');

              // Small delay before starting bot responses
              await new Promise(resolve => setTimeout(resolve, 250));

              // Have each bot respond to the conversation
              for (const bot of bots) {
                try {
                  // Build prompt with conversation context
                  const contextPrompt = `You are at ${location.name} during an emergency. Here's the recent conversation:\n\n${conversationContext}\n\n${ROUND_PROMPT}`;

                  // Call Ollama
                  const ollamaResponse = await fetch(LOCAL_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model: MODEL,
                      prompt: contextPrompt,
                      system: bot.systemPrompt,
                      stream: false,
                    }),
                  });

                  const ollamaData = await ollamaResponse.json();
                  const responseText = ollamaData.response || 'No response';

                  // Post bot's response to thread
                  const messageEndpoint = `channels/${threadId}/messages`;
                  await DiscordRequest(messageEndpoint, {
                    method: 'POST',
                    body: {
                      content: `**${bot.emoji} ${bot.name}**\n${responseText}`,
                    },
                  });

                  location.transcript = location.transcript + `^* Name:${bot.name} Personality:${bot.personalityCode}\n${responseText} *^\n\n`;
                  incrementMessageCount(simulation, location.name, 1);
                  console.log(`  ✓ ${bot.name} (Round ${round})`);

                  // Delay between bot responses
                  await new Promise(resolve => setTimeout(resolve, 300));

                } catch (botErr) {
                  console.error(`  ✗ Error with ${bot.name} in round ${round}:`, botErr.message);
                }
              }

              // Mark this location's round as complete
              setLocationRound(simulation, location.name, round);
              console.log(`✓ Completed round ${round} at ${location.name}`);

            } catch (locationErr) {
              console.error(`Error in round ${round} at ${location.name}:`, locationErr);
            }
          }

          // Mark this round as complete
          completeRound(simulation);

          // Update main message with round progress
          const roundStats = simulation.locations.map(loc =>
            `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages (Round ${loc.currentRound}/${roundCount})`
          ).join('\n');

          const roundProgressMessage = `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n` +
                                      `✅ Emergency alert posted!\n` +
                                      `✅ Initial responses complete!\n` +
                                      `🔄 **Conversation Round ${round}/${roundCount} complete!**\n\n` +
                                      `**Current Status:**\n${roundStats}\n\n` +
                                      `**Total Messages:** ${simulation.stats.messagesPosted}\n\n` +
                                      (round < roundCount
                                        ? `⏳ Starting round ${round + 1}...`
                                        : `⏳ Beginning Final Round...`);

          await safeUpdateMessage(getMessageEndpoint, roundProgressMessage);

          console.log(`✓ Round ${round}/${roundCount} complete! Total messages: ${simulation.stats.messagesPosted}`);

          // Small delay between rounds
          if (round < roundCount) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        //========  Final Response ===============
        console.log(`\n==Starting Final Round==`);

        // Process each location in this round
        for (const location of simulation.locations) {
          const threadId = location.threadId;
          const bots = location.bots;

          console.log(`Final Response at ${location.name}...`);
          location.transcript = location.transcript + `\n=====Final Response=====\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;

          try {
            // Fetch recent messages from this thread to build context
            const messagesEndpoint = `channels/${threadId}/messages?limit=20`;
            const messagesResponse = await DiscordRequest(messagesEndpoint, { method: 'GET' });
            const messages = await messagesResponse.json();

            // Reverse so oldest first
            const recentMessages = messages.reverse();

            // Build conversation context (last 10 messages)
            const contextMessages = recentMessages.slice(-10);
            const conversationContext = contextMessages
              .map(msg => {
                // Extract bot name and message
                const content = msg.content;
                if (content.includes('**') && !content.includes('EMERGENCY ALERT')) {
                  return content;
                }
                return null;
              })
              .filter(Boolean)
              .join('\n\n');

            // Small delay before starting bot responses
            await new Promise(resolve => setTimeout(resolve, 250));

            // Have each bot respond to the conversation
            for (const bot of bots) {
              try {
                // Build prompt with conversation context
                const contextPrompt = `You are at ${location.name} during an emergency. Here's the recent conversation:\n\n${conversationContext}\n\n${FINAL_PROMPT}`;

                // Call Ollama
                const ollamaResponse = await fetch(LOCAL_ENDPOINT, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: MODEL,
                    prompt: contextPrompt,
                    system: bot.systemPrompt,
                    stream: false,
                  }),
                });

                const ollamaData = await ollamaResponse.json();
                const responseText = ollamaData.response || 'No response';

                // Post bot's response to thread
                const messageEndpoint = `channels/${threadId}/messages`;
                await DiscordRequest(messageEndpoint, {
                  method: 'POST',
                  body: {
                    content: `**${bot.emoji} ${bot.name}**\n${responseText}`,
                  },
                });


                location.transcript = location.transcript + `^* Name:${bot.name} Personality:${bot.personalityCode}\n${responseText} *^\n`;
                incrementMessageCount(simulation, location.name, 1);
                console.log(`  ✓ ${bot.name} (Final Round)`);

                // Delay between bot responses
                await new Promise(resolve => setTimeout(resolve, 300));

              } catch (botErr) {
                console.error(`  ✗ Error with ${bot.name} in final round:`, botErr.message);
              }
            }

            console.log(`✓ Completed Final Round at ${location.name}`);
            location.transcript = location.transcript + `======TRANSCRIPT COMPLETE======`;
            createFileAsync(`./Transcripts/${simulation.id}/${location.name}`,`${location.transcript}`);

          } catch (locationErr) {
            console.error(`Error in Final Round at ${location.name}:`, locationErr);
          }
        }

        // Update main message with round progress
        const roundStats = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages (Final Round)`
        ).join('\n');

        const roundProgressMessage = `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n` +
                                    `✅ Emergency alert posted!\n` +
                                    `✅ Initial responses complete!\n` +
                                    `✅ Conversation Round Completed!\n` +
                                    `🔄 **Final Round in progress!**\n\n` +
                                    `**Current Status:**\n${roundStats}\n\n` +
                                    `**Total Messages:** ${simulation.stats.messagesPosted}\n\n` +
                                    `⏳ Finalizing Simulation...`;

        await safeUpdateMessage(getMessageEndpoint, roundProgressMessage);

        console.log(`✓ Final Round complete! Total messages: ${simulation.stats.messagesPosted}`);


        // ===== Simulation COMPLETION =====

        console.log(`\nAll rounds complete! Finalizing simulation...`);

        // Mark simulation as complete
        updateSimulationStatus(simulation, 'complete');


        // Build final completion summary
        const completionSummary = formatCompletionSummary(simulation);

        const finalStats = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages`
        ).join('\n');

        finalMessage = `${summary}\n\n**Location Threads:**\n${threadLinks}\n\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `🏁 **SIMULATION COMPLETE!** 🏁\n\n` +
                            `**Final Statistics:**\n${finalStats}\n\n` +
                            `**Total Messages:** ${simulation.stats.messagesPosted}\n` +
                            `**Rounds Completed:** ${simulation.stats.roundsCompleted}/${roundCount}\n` +
                            `**Total Residents:** ${simulation.stats.totalBots}\n\n` +
                            `✅ All conversations archived in location threads above.\n` +
                            `Thank you for running this emergency simulation!`;

        await safeUpdateMessage(getMessageEndpoint, finalMessage);

        console.log(`🏁 Simulation ${simulation.id} complete!`);
        console.log(`   Total messages: ${simulation.stats.messagesPosted}`);
        console.log(`   Rounds: ${simulation.stats.roundsCompleted}/${roundCount}`);
        console.log(`   Status: ${simulation.status}`);

      } catch (err) {
        console.error('Simulation creation error:', err);

        // Update message with error
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
