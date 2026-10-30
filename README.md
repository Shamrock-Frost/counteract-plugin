# PF2e Counteract Automation

A Foundry VTT module for Pathfinder 2nd Edition that automates counteract checks using the Remaster rules.

## Features

- **Two Counteract Modes**, switched with a toggle at the top of the window:
  - **Dispel Effect** - For spells like Dispel Magic targeting ongoing effects on a token
  - **Counterspell** - For the Counterspell reaction, targeting an enemy caster

- **Smart Auto-Population:**
  - Uses your spellcasting entry's counteract modifier
  - Pulls effects and afflictions from the targeted token, and follows your target as it changes
  - Shows the enemy caster's recently cast spells first (from chat history)
  - Uses the original caster's spell DC or the affliction's DC when PF2e recorded it, otherwise the DC for the rank

- **Know your odds before rolling:** the window shows the degree of success you need, the total that gets it, and your chance

- **Readable results:** the chat card says whether it counteracted and why, and a successful dispel has a button to remove the effect

- **Full Remaster Rules Support:**
  - Correct DC calculation (caster's spell DC or fallback table)
  - Proper rank calculation (spells and spell effects use their rank, other effects use level/2)
  - Accurate degree of success thresholds, including natural 1s and 20s

## Installation

### Manual Installation
1. Download the latest release
2. Extract to `Data/modules/counteract-plugin/` in your Foundry user data folder
3. Restart Foundry and enable the module in your world

### Manifest URL
```
https://github.com/Shamrock-Frost/counteract-plugin/releases/latest/download/module.json
```

## Usage

### Opening the Window

**Option 1: Scene Controls** (if enabled in settings)
- Click the Token tools in the left toolbar
- Click the ban/circle icon

**Option 2: Console/Macro**
```javascript
game.counteract.open()             // Opens in the mode you used last
game.counteract.openDispel()       // Opens Dispel mode directly
game.counteract.openCounterspell() // Opens Counterspell mode directly
```

**Option 3: Spell Chat Cards**
- Cast a spell that counteracts (like Dispel Magic)
- Click the "Counteract" button on the chat card; the window opens with that spell and its cast rank filled in

### Dispel Effect Mode

Use this when casting Dispel Magic or similar spells on an ongoing effect:

1. **Target a token** that has an effect you want to dispel
2. Open the counteract window and choose **Dispel Effect**
3. Choose your caster and counteracting spell
4. Pick the effect from the dropdown; its rank and DC fill in
5. Check the odds, then click **Roll Counteract Check**
6. On a success, the GM can click **Remove** on the chat card to end the effect

### Counterspell Mode

Use this when using the Counterspell reaction:

1. **Target the enemy caster**
2. Open the counteract window and choose **Counterspell**
3. Choose your caster and the spell you're expending
4. Pick the spell being cast; recently cast spells are listed first
5. Click **Roll Counteract Check**

### Manual Entry

Without a target, or for anything the dropdowns don't cover:
- Enter the name, rank, and DC directly
- The DC follows the rank using the fallback table until you type your own

## Counteract Rules Reference

### Degree of Success - Maximum Target Rank You Can Counteract

| Your Rank | Crit Fail | Failure | Success | Crit Success |
|-----------|-----------|---------|---------|--------------|
| 1         | Never     | 0       | 2       | 4            |
| 2         | Never     | 1       | 3       | 5            |
| 3         | Never     | 2       | 4       | 6            |
| ...       | ...       | rank-1  | rank+1  | rank+3       |

### Fallback DC by Rank

When you don't know the original caster's spell DC:

| Rank | DC  |
|------|-----|
| 1    | 15  |
| 2    | 18  |
| 3    | 20  |
| 4    | 23  |
| 5    | 26  |
| 6    | 28  |
| 7    | 31  |
| 8    | 34  |
| 9    | 36  |
| 10   | 39  |

## Compatibility

- Foundry VTT: v13 - v14
- PF2e System: v7.0+ (tested on 8.6.1)

## License

MIT
