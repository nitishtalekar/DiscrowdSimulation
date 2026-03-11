## Documentation for Commands.js

File holds details on slash commands used in Discord. 

# TEST_COMMAND
Command used to test the connection is established when running the program
```
/test
```
Should return
```
Hellow World<random emoji>
```

# SIMULATE_COMMAND
Command used to set up and run the simulation
```
/simulate <number of locations to include> <number of conversation rounds to do>
```
* Number of locations to include
  * Current setup is anywhere from 4-6
  * Must have minimum capacity >= the number of residents
  * More locations can be added, must add to locatoins.js and increase chocies in commands.js
* Number of rounds to do
  * When you click start and send your initial message, all bots will give their response. This counts as round 0
  * Each round bots will view the chat history of the last 10 messages and create a response
  * More rounds means higher runtime
  * Number of rounds can be changed, add more choices with corresponding value to commands.js
    * { name: '10 rounds', value: 10 }

# ALL_COMMANDS

Comma separated list with all the commands. If you want to add new commands, they need to be in this list
To register newly created commands, put the command in the ALL_COMMANDS list and run
```npm register```

