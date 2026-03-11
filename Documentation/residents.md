## Documentation for Residents.js

File holds a list of residents. Global variables allow for more consistent settings for bot background. 

# Exports
* TOWN_RESIDENTS
  * A list of the residents in the town 
  * Example Resident
  ```
    {
    name: '👵 Eleanor',
    emoji: '👵',
    role: 'elderly_disabled',
    locationAffinities: {
      'Beachside Library': 0.7,
      'Coastal Community Church': 0.5,
      'Main Street General Store': 0.4,
    },
    defaultLocationWeight: 0.25,
    systemPrompt: `You are Eleanor. ${FROM} You are elderly, and have a disability with high medical needs that makes you wheelchair bound. Mobility is difficult for you physically and with regards to transportation. When discussing situations, describe your understanding in a conversational way and mention your concerns about mobility and medical needs. ${RESPONSE_DETAIL}`
  }
  ```
  
# Global Consts
* FROM
  * "You are a resident of Manteo, North Carolina."
  * Change to make all the bots think they're in a new location, just for backstory 
* RESPONSE_DETAIL
  * "Keep responses relatively concise (2-4 sentences) and at most 2000 characters."
  * Discord requires responses < 2000 characters