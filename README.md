# PF2e Counteract Automation

A Foundry VTT module for Pathfinder 2nd Edition that automates counteract checks using the Remaster rules.

## Features

- **Two Counteract Modes:**
  - **Dispel Effect** - For spells like Dispel Magic targeting ongoing effects on a token
  - **Counterspell** - For the Counterspell reaction, targeting an enemy caster

- **Smart Auto-Population:**
  - Detects your spellcasting modifier from your character
  - Pulls effects/afflictions from targeted tokens
  - Shows enemy caster's spells sorted by recently cast (from chat history)
  - Auto-calculates DC from rank using the official fallback table

- **Full Remaster Rules Support:**
  - Correct DC calculation (caster's spell DC or fallback table)
  - Proper rank calculation (spells use rank, effects use level/2)
  - Accurate degree of success thresholds

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

### Opening the Dialog

**Option 1: Scene Controls** (if enabled in settings)
- Click the Token tools in the left toolbar
- Click the ban/circle icon

**Option 2: Console/Macro**
```javascript
game.counteract.open()           // Shows mode selection first
game.counteract.openDispel()     // Opens Dispel mode directly
game.counteract.openCounterspell() // Opens Counterspell mode directly
```

**Option 3: Spell Chat Cards**
- Cast a spell with the Counteract trait (like Dispel Magic)
- Click the "Counteract" button on the chat card

### Dispel Effect Mode

Use this when casting Dispel Magic or similar spells on an ongoing effect:

1. **Target a token** that has an effect you want to dispel
2. Open the counteract dialog
3. Select **Dispel Effect**
4. Choose your actor and counteracting spell
5. Select the target effect from the dropdown (or use Manual Input)
6. Click **Roll Counteract**

### Counterspell Mode

Use this when using the Counterspell reaction:

1. **Target the enemy caster**
2. Open the counteract dialog
3. Select **Counterspell**
4. Choose your actor and the spell you're expending
5. Select the spell being cast from the dropdown (recently cast spells marked with a star)
6. Click **Roll Counteract**

### Manual Entry

If you don't have a target or need to enter custom values:
- Select "Manual Input" from the dropdown
- Enter the target's name, rank, and DC
- The DC auto-fills from the rank using the fallback table, but you can override it

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
