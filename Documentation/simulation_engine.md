## Documentation for simulation_engine.js

File creates and manages the simulation

# Exports
* createSimulation 
  * creates the simulation from user input
  * Input:
    * locationCount
    * roundCount
    * emergencyMessage: user given message
  * Output
    * simulation
* getSimulationStats
  * gets the stats for the simulation
  * Input
    * simulation object
  * Output
    * totalBots
    * totalLocations
    * totalRounds
    * messagesPosted
    * roudsCompleted
    * locationBreakdown
* updateSimulationStatus
  * updates the simulation status if complete
  * Input
    * simulation
    * status
* setLocationThreadId
  * sets the thread id for the location for the simulation
  * Input
    * simulation
    * locationName
    * threadID
* incrementMessageCount
  * increases the message count for each thread as the bots respond
  * Input
    * simulation
    * locationName
    * count
* setLocationRound
  * sets the round of conversation per location during the simulation
  * Input
    * simulation
    * locationName
    * roundNumber
* completeRound
  * increments the rounds completed stat for the simulation
  * Input
    * simulation
* getBotsAtLocation
  * returns a list of bots at a location
  * Input
    * simulation
    * locationName
  * Output
    * list of bots at given location
* getLocationThreadId
  * gets the thread id based on location name
  * Input
    * simulation
    * locationName
  * Output
    * threadId
* formatSimulationSummary
  * formats the simulation summary for pretty printing
  * Input
    * simulation
  * Output
    * simulation summary string
* formatCompletionSummary
  * formats the completion summary for pretty printing
  * Input
    * simulation
  * Output
    * completion summary string

# Helper Functions
* generateSimulationId
  * generates the simulationid using the date and a random number
  * Output
    * simulationID
* 