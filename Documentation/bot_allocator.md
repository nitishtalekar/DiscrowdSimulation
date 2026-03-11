## Documentation for bot_allotcator.js

File responsible for allocating bots to the location list for each simulation
Bots = Residents, the wording is interchangeable in the documentation
Simulations won't always have all the locations in the preset list

# Exports

* calculateLocationWeights
  * calulates the location weighting per bot based on predefiend weighting from reidents.js
  * Input
    * bot:one of the residents 
    * locations: list of locations for the simulation run
  * Output
    * weights: list of weights for each location
* assignBotsToLocations
  * assigns bots to available locations. Greedy, doesn't find best weighting for each just assigns
  * Input
    * bots: list of residents
    * locations: list of locations for the simulation
  * Ouptut
    * assignments
      * list of what bot goes where
* validateAssignments
  * checks that bots are only assigned once and that all locations are within capacity
  * Inputs
    * assignments: list of what bot goes where
    * bots: list of redidents
    * locations: list of locations for the simulation
  * Output
    * valid boolean
    * list of errors and warnings
* printAssignmentSummary
  * prints summary of assignments in pretty format in Discord channel
  * Input: assignments
* getAssignmentStats
  * gets stats for the assignment for the simulation
  * Input: assignments
  * Output
    * Total Number of Bots
    * Location Count
    * Average Bots per Location
    * minimum Bots
    * maximum Bots

# Helper Functions
* normalizeToProbabilities
  * normalizes the probablity weighting for each resident
  * Input: weights
  * Output: probabilities
* selectLocationByProbability
  * selects a location for the bot based on calculated probabilties
  * Input: probabilities
  * Ouptut: location
* isLocationAtCapacity
  * checks if a location is at capacity
  * Input:
    * assignments
    * location
  * Output: boolean, true if assignments.length >= location.capacity.max
