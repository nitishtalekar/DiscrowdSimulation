import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { getRandomEmoji, DiscordRequest } from './utils/utils.js';
import {
  createSimulation,
  formatSimulationSummary,
  setLocationThreadId,
  updateSimulationStatus,
  incrementMessageCount,
  getSimulationStats,
  completeRound,
  setLocationRound,
} from './simulation_engine.js';
import { buildSystemPrompt, INITIAL_RESPONSE_PROMPT, ROUND_PROMPT, FINAL_PROMPT } from './utils/prompts.js';
import { MODEL, OLLAMA_BASE_URL, DISCORD_MESSAGES } from './utils/constants.js';
import { ChatOllama } from '@langchain/community/chat_models/ollama';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import fs from 'fs/promises';

const CONTEXT_WINDOW_SIZE = parseInt(process.env.CONTEXT_WINDOW_SIZE ?? '10', 10);

const ollamaClient = new ChatOllama({
  baseUrl: OLLAMA_BASE_URL,
  model: MODEL,
});

// Check for XSS and injection attempts
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

  const sqlPatterns = ['drop table', 'delete from', 'insert into', 'update set', '1=1', "1'='1"];
  for (const pattern of sqlPatterns) {
    if (lowerMessage.includes(pattern)) {
      errors.push('Message contains SQL-like injection patterns');
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

async function createFolder(folderPath) {
  try {
    await fs.mkdir(folderPath, { recursive: true });
  } catch (err) {
    console.error('Error creating folder:', err);
  }
}

async function writeFile(filename, content) {
  try {
    await fs.writeFile(filename, content);
  } catch (err) {
    console.error('Error writing file:', err);
  }
}

// Silently skips if the interaction token has expired (15 min limit)
async function safeUpdateMessage(endpoint, content) {
  try {
    await DiscordRequest(endpoint, { method: 'PATCH', body: { content } });
  } catch (err) {
    console.warn('Could not update main message (token may have expired):', err.message);
  }
}

/**
 * Builds a LangChain message array from shared conversation history.
 * Applies a sliding window of the last `windowSize` messages, then appends the current prompt.
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

const activeSimulations = new Map();
// Map<simulationId, Map<locationName, Array<{role, name, content}>>>
const locationConversations = new Map();

const app = express();
const PORT = process.env.PORT || 3000;

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { id, type, data } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

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
            content: DISCORD_MESSAGES.securityError(securityCheck.errors),
            flags: 64,
          },
        });
      }

      res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: DISCORD_MESSAGES.simulationStarting(locationCount, roundCount),
        },
      });

      try {
        const simulation = createSimulation(locationCount, roundCount, emergencyMessage);
        console.log(`Created simulation: ${simulation.id}`);

        activeSimulations.set(simulation.id, simulation);

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
            const threadResponse = await DiscordRequest(`channels/${channelId}/threads`, {
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

        await safeUpdateMessage(getMessageEndpoint, DISCORD_MESSAGES.setupComplete(summary, threadLinks));

        console.log(`Simulation ${simulation.id} setup complete`);
        await createFolder(`./Transcripts/${simulation.id}`);

        updateSimulationStatus(simulation, 'running');

        // ===== PHASE 1: INITIAL RESPONSES =====

        for (const location of simulation.locations) {
          const threadId = location.threadId;
          const bots = location.bots;
          const convHistory = locationConversations.get(simulation.id).get(location.name);

          console.log(`Processing location: ${location.name} (${bots.length} bots)`);

          try {
            await DiscordRequest(`channels/${threadId}/messages`, {
              method: 'POST',
              body: { content: DISCORD_MESSAGES.alertHeader(emergencyMessage, location.name) },
            });

            convHistory.push({ role: 'user', name: 'EMERGENCY ALERT', content: emergencyMessage });
            incrementMessageCount(simulation, location.name, 1);
            console.log(`Posted emergency alert to ${location.name}`);

            await new Promise(resolve => setTimeout(resolve, 250));

            for (const bot of bots) {
              try {
                const systemPrompt = buildSystemPrompt(bot);
                const currentPrompt = INITIAL_RESPONSE_PROMPT(location.name, emergencyMessage);
                const messages = buildLangChainMessages(systemPrompt, convHistory, CONTEXT_WINDOW_SIZE, currentPrompt);

                const llmResponse = await ollamaClient.invoke(messages);
                const responseText = llmResponse.content || 'No response';

                await DiscordRequest(`channels/${threadId}/messages`, {
                  method: 'POST',
                  body: { content: `**${bot.emoji} ${bot.name}**\n${responseText}` },
                });

                convHistory.push({ role: 'assistant', name: bot.name, content: responseText });
                incrementMessageCount(simulation, location.name, 1);
                console.log(`  ✓ ${bot.name} responded`);

                await new Promise(resolve => setTimeout(resolve, 300));
              } catch (botErr) {
                console.error(`  ✗ Error with ${bot.name}:`, botErr.message);
                await DiscordRequest(`channels/${threadId}/messages`, {
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
          DISCORD_MESSAGES.afterInitialResponses(summary, threadLinks, stats.totalBots, statsText)
        );

        console.log(`Initial responses complete! Total messages: ${simulation.stats.messagesPosted - simulation.locations.length}`);

        // ===== PHASE 2: CONVERSATION ROUNDS =====

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
                  const currentPrompt = ROUND_PROMPT(location.name);
                  const messages = buildLangChainMessages(systemPrompt, convHistory, CONTEXT_WINDOW_SIZE, currentPrompt);

                  const llmResponse = await ollamaClient.invoke(messages);
                  const responseText = llmResponse.content || 'No response';

                  await DiscordRequest(`channels/${threadId}/messages`, {
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
            DISCORD_MESSAGES.afterRound(summary, threadLinks, round, roundCount, roundStats, simulation.stats.messagesPosted)
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

          console.log(`Final response at ${location.name}...`);

          try {
            await new Promise(resolve => setTimeout(resolve, 250));

            for (const bot of bots) {
              try {
                const systemPrompt = buildSystemPrompt(bot);
                const currentPrompt = FINAL_PROMPT(location.name);
                const messages = buildLangChainMessages(systemPrompt, convHistory, CONTEXT_WINDOW_SIZE, currentPrompt);

                const llmResponse = await ollamaClient.invoke(messages);
                const responseText = llmResponse.content || 'No response';

                await DiscordRequest(`channels/${threadId}/messages`, {
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

            console.log(`✓ Completed final round at ${location.name}`);

            const transcriptData = {
              simulationId: simulation.id,
              location: location.name,
              emergencyMessage: simulation.emergencyMessage,
              messages: convHistory,
            };
            writeFile(
              `./Transcripts/${simulation.id}/${location.name}.json`,
              JSON.stringify(transcriptData, null, 2)
            );
          } catch (locationErr) {
            console.error(`Error in final round at ${location.name}:`, locationErr);
          }
        }

        const finalRoundStats = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages (Final Round)`
        ).join('\n');

        await safeUpdateMessage(
          getMessageEndpoint,
          DISCORD_MESSAGES.finalRoundInProgress(summary, threadLinks, finalRoundStats, simulation.stats.messagesPosted)
        );

        console.log(`✓ Final round complete! Total messages: ${simulation.stats.messagesPosted}`);

        // ===== SIMULATION COMPLETE =====

        updateSimulationStatus(simulation, 'complete');

        const finalStats = simulation.locations.map(loc =>
          `• ${loc.emoji} **${loc.name}**: ${loc.messageCount} messages`
        ).join('\n');

        await safeUpdateMessage(
          getMessageEndpoint,
          DISCORD_MESSAGES.simulationComplete(
            summary, threadLinks, finalStats,
            simulation.stats.messagesPosted,
            simulation.stats.roundsCompleted, roundCount,
            simulation.stats.totalBots
          )
        );

        locationConversations.delete(simulation.id);

        console.log(`🏁 Simulation ${simulation.id} complete!`);
        console.log(`   Total messages: ${simulation.stats.messagesPosted}`);
        console.log(`   Rounds: ${simulation.stats.roundsCompleted}/${roundCount}`);

      } catch (err) {
        console.error('Simulation error:', err);
        const getMessageEndpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`;
        await DiscordRequest(getMessageEndpoint, {
          method: 'PATCH',
          body: { content: DISCORD_MESSAGES.simulationError(err.message) },
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
