import 'dotenv/config';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Simple test command
const TEST_COMMAND = {
  name: 'test',
  description: 'Basic command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

// Town emergency simulation command with dropdown selections
const SIMULATE_COMMAND = {
  name: 'simulate',
  description: 'Start a town emergency simulation',
  options: [
    {
      type: 4, // Integer
      name: 'locations',
      description: 'Number of locations in the town',
      required: true,
      choices: [
        { name: '4 locations', value: 4 },
        { name: '5 locations', value: 5 },
        { name: '6 locations', value: 6 },
      // if you add more locations to locations.js, add additional choices. must have at least enough capacity for every bot to be placed
      ]
    },
    {
      type: 4, // Integer
      name: 'rounds',
      description: 'Number of conversation rounds',
      required: true,
      choices: [
        { name: '1 round', value: 1 },
        { name: '2 rounds', value: 2 },
        { name: '3 rounds', value: 3 },
        { name: '4 rounds', value: 4 },
        { name: '5 rounds', value: 5 },
        { name: '6 rounds', value: 6 },
        { name: '7 rounds', value: 7 },
        { name: '8 rounds', value: 8 },
        { name: '9 rounds', value: 9 },
        { name: '10 rounds', value: 10 },
      ]
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

// any new commands need to be added to this list
const ALL_COMMANDS = [TEST_COMMAND, SIMULATE_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
