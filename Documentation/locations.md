## Documentation page for Location.js

File holds list of preset locations and helper methods to get data about them

# Exports

* LOCATION_PRESETS
  * A list of preset locations based on a coastal NC town
    * Example Location
  ```
  {
    name: 'The Dockside Diner',
    type: 'commercial',
    capacity: { min: 6, max: 10 },
    description: 'Local breakfast and lunch spot near the marina where locals gather for coffee and conversation',
    emoji: '☕'
  }
  ```
* getLocationByName
  * Gets the locations from the preset list by name
    * Input: locationName
    * Output: Location from preset list
* getRandomLocations
  * Gets a given number of random locations 
    * Input: count
    * Output: a number shuffled list of preset locations, determined by count
    * Throws Error: Count is bigger than number of locations
* getTotalCapacity
  * Gets the total capacity for a location list
    * Input: locatoins
    * Output: min and max capacity