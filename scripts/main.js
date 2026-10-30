/**
 * PF2e Counteract Automation Module
 * Automates counteract checks using the PF2e Remaster rules
 */

const MODULE_ID = "counteract-plugin";

/**
 * Degree of success constants
 */
const DEGREE = {
  CRITICAL_SUCCESS: "criticalSuccess",
  SUCCESS: "success",
  FAILURE: "failure",
  CRITICAL_FAILURE: "criticalFailure"
};

/**
 * Official PF2e Remaster spell rank DCs
 * Source: https://2e.aonprd.com/Rules.aspx?ID=2629
 */
const SPELL_RANK_DC = [
  null, // index 0 unused
  15,   // rank 1
  18,   // rank 2
  20,   // rank 3
  23,   // rank 4
  26,   // rank 5
  28,   // rank 6
  31,   // rank 7
  34,   // rank 8
  36,   // rank 9
  39    // rank 10
];

/**
 * Calculate the counteract DC for a given rank
 * Uses official PF2e spell rank DC table
 * @param {number} rank - The counteract rank (1-10)
 * @returns {number} - The counteract DC
 */
function calculateCounteractDC(rank) {
  return SPELL_RANK_DC[rank] ?? 15;
}

/**
 * Calculate the counteract rank for non-spell effects
 * Per PF2e rules: halve level and round up
 * Note: Spells use their spell rank directly, not this function
 * @param {number} level - The level of the effect
 * @returns {number} - The counteract rank
 */
function calculateCounteractRank(level) {
  return Math.ceil(level / 2);
}

/**
 * Check if a counteract succeeds based on PF2e Remaster rules
 * @param {number} sourceRank - The rank of the counteracting effect
 * @param {number} targetRank - The rank of the target effect
 * @param {string} degreeOfSuccess - The degree of success on the check
 * @returns {Object} - { success: boolean, threshold: number, margin: number }
 */
function checkCounteract(sourceRank, targetRank, degreeOfSuccess) {
  let threshold;
  let success = false;

  switch (degreeOfSuccess) {
    case DEGREE.CRITICAL_SUCCESS:
      threshold = sourceRank + 3;
      success = targetRank <= threshold;
      break;
    case DEGREE.SUCCESS:
      threshold = sourceRank + 1;
      success = targetRank <= threshold;
      break;
    case DEGREE.FAILURE:
      threshold = sourceRank - 1; // Can counteract effects of lower rank (< sourceRank)
      success = targetRank <= threshold;
      break;
    case DEGREE.CRITICAL_FAILURE:
      threshold = null; // Cannot counteract anything on critical failure
      success = false;
      break;
    default:
      console.warn(`${MODULE_ID} | Unknown degree of success: ${degreeOfSuccess}`);
      threshold = null;
      success = false;
  }

  return {
    success,
    threshold,
    margin: threshold !== null ? threshold - targetRank : null
  };
}

/**
 * Determine degree of success from roll total vs DC
 * @param {number} total - The roll total
 * @param {number} dc - The target DC
 * @param {number} dieResult - The natural die result
 * @returns {string} - The degree of success
 */
function getDegreeOfSuccess(total, dc, dieResult) {
  const difference = total - dc;
  let degree;

  if (difference >= 10) {
    degree = DEGREE.CRITICAL_SUCCESS;
  } else if (difference >= 0) {
    degree = DEGREE.SUCCESS;
  } else if (difference >= -10) {
    degree = DEGREE.FAILURE;
  } else {
    degree = DEGREE.CRITICAL_FAILURE;
  }

  // Natural 20 upgrades by one step
  if (dieResult === 20) {
    if (degree === DEGREE.CRITICAL_FAILURE) degree = DEGREE.FAILURE;
    else if (degree === DEGREE.FAILURE) degree = DEGREE.SUCCESS;
    else if (degree === DEGREE.SUCCESS) degree = DEGREE.CRITICAL_SUCCESS;
  }

  // Natural 1 downgrades by one step
  if (dieResult === 1) {
    if (degree === DEGREE.CRITICAL_SUCCESS) degree = DEGREE.SUCCESS;
    else if (degree === DEGREE.SUCCESS) degree = DEGREE.FAILURE;
    else if (degree === DEGREE.FAILURE) degree = DEGREE.CRITICAL_FAILURE;
  }

  return degree;
}

/**
 * Get effects on a token that can be counteracted
 * Includes effect and affliction items (PF2e keeps ongoing effects as items;
 * conditions have no level, so they aren't offered)
 *
 * Rank: effects that came from a spell store the spell's rank as their level,
 * so that is their counteract rank; anything else uses half its level.
 * DC: the originating caster's spell DC when PF2e recorded the origin, the
 * affliction's own DC for afflictions, else the fallback table by rank.
 *
 * @param {Token} token - The Foundry token
 * @returns {Array} - Array of effect objects with name, rank, and id
 */
function getEffectsOnToken(token) {
  if (!token?.actor) return [];

  const effects = [];
  for (const item of token.actor.items) {
    if (item.type !== "effect" && item.type !== "affliction") continue;

    const level = Number(item.system?.level?.value) || 1;
    // PF2e sets fromSpell on creation; the slug check covers effects that predate it
    const fromSpell = !!item.system?.fromSpell || (item.slug ?? "").startsWith("spell-effect-");
    const rank = fromSpell ? Math.clamp(level, 1, 10) : calculateCounteractRank(level);

    // PF2e records the casting item on effects dragged from a spell card
    const originUuid = item.system?.context?.origin?.item;
    const originItem = originUuid ? fromUuidSync(originUuid) : null;
    const originDC = originItem?.spellcasting?.statistic?.dc?.value;
    const afflictionDC = item.type === "affliction" ? item.system?.save?.value : null;
    const dc = originDC || afflictionDC || calculateCounteractDC(rank);

    effects.push({
      id: item.id,
      name: item.name,
      img: item.img,
      level,
      rank,
      dc,
      dcSource: originDC ? "caster" : afflictionDC ? "affliction" : "table",
      fromSpell,
      type: item.type
    });
  }

  return effects;
}

/**
 * Get spells from an actor
 * @param {Actor} actor - The Foundry actor
 * @param {Object} options - Options for filtering/sorting
 * @param {boolean} options.counteractOnly - Only return spells with counteract trait
 * @returns {Array} - Array of spell objects with entry ID for modifier lookup
 */
function getSpellsFromActor(actor, options = {}) {
  if (!actor) return [];

  const spells = [];

  for (const item of actor.items) {
    if (item.type === "spell") {
      // PF2e flags counteracting spells with system.counteraction (there is no trait)
      const hasCounteractTrait = !!item.system?.counteraction;

      if (options.counteractOnly && !hasCounteractTrait) continue;

      spells.push({
        id: item.id,
        name: item.name,
        img: item.img,
        // item.rank is the heightened rank; system.level.value is only the base rank
        rank: item.rank ?? item.system?.level?.value ?? 1,
        hasCounteractTrait,
        entryId: item.system?.location?.value ?? null
      });
    }
  }

  return spells;
}

// Alias for backwards compatibility
function getCounteractSpells(actor) {
  return getSpellsFromActor(actor);
}

/**
 * Get an actor's spell DC
 * @param {Actor} actor - The Foundry actor
 * @returns {number} - The spell DC, or 0 if not found
 */
function getSpellDC(actor) {
  if (!actor) return 0;

  // Spell DC (PF2e: the best spellcasting entry's DC)
  const spellDC = actor.system?.attributes?.spellDC?.value;
  if (spellDC) return spellDC;

  // Higher of class or spell DC
  const classOrSpellDC = actor.system?.attributes?.classOrSpellDC?.value;
  if (classOrSpellDC) return classOrSpellDC;

  // Try from spellcasting entries
  const spellcasting = actor.spellcasting;
  if (spellcasting?.contents?.length > 0) {
    const entry = spellcasting.contents[0];
    const dc = entry.statistic?.dc?.value ?? entry.statistic?.dc;
    if (dc) return dc;
  }

  // Fallback: class DC
  const classDC = actor.system?.attributes?.classDC?.value;
  if (classDC) return classDC;

  return 0;
}

/**
 * Get spells recently cast by an actor, sorted by most recent
 * Scans chat messages for spell cards from this actor
 * @param {Actor} actor - The Foundry actor
 * @param {number} limit - Maximum number of messages to scan
 * @returns {Array} - Array of {spellId, spellName, rank, timestamp} sorted by recency
 */
function getRecentlyCastSpells(actor, limit = 50) {
  if (!actor) return [];

  const recentCasts = [];
  const messages = game.messages.contents.slice(-limit).reverse();

  for (const message of messages) {
    // Check if message is from this actor
    const speakerId = message.speaker?.actor;
    if (speakerId !== actor.id) continue;

    // PF2e records the cast spell and its rank in the message's origin flag
    const origin = message.flags?.pf2e?.origin;
    if (origin?.type !== "spell" || !origin.uuid) continue;

    const spellId = foundry.utils.parseUuid(origin.uuid)?.id;
    const spell = actor.items.get(spellId);
    if (spell?.type === "spell") {
      recentCasts.push({
        id: spellId,
        name: spell.name,
        rank: Number(origin.castRank) || spell.rank || 1,
        timestamp: message.timestamp
      });
    }
  }

  // Remove duplicates, keeping most recent
  const seen = new Set();
  return recentCasts.filter(spell => {
    if (seen.has(spell.id)) return false;
    seen.add(spell.id);
    return true;
  });
}

/**
 * Get the spellcasting modifier for an actor, optionally for a specific spell's entry
 * @param {Actor} actor - The Foundry actor
 * @param {string|null} entryId - Optional spellcasting entry ID to use
 * @returns {number} - The spellcasting modifier
 */
function getSpellcastingModifier(actor, entryId = null) {
  if (!actor) return 0;

  const spellcasting = actor.spellcasting;
  if (!spellcasting) return getFallbackModifier(actor);

  // PF2e gives each spellcasting entry a dedicated counteract statistic
  // (the entry's attribute and proficiency); prefer it over the spell attack
  const entryMod = (entry) => entry?.counteraction?.mod ?? entry?.statistic?.mod;

  if (entryId) {
    const mod = entryMod(spellcasting.get(entryId));
    if (mod !== undefined) return mod;
  }

  // Fall back to the first entry that has a statistic
  for (const entry of spellcasting.contents ?? []) {
    const mod = entryMod(entry);
    if (mod !== undefined) return mod;
  }

  return getFallbackModifier(actor);
}

/**
 * Get fallback modifier from spell DC or class DC
 * @param {Actor} actor - The Foundry actor
 * @returns {number} - The fallback modifier
 */
function getFallbackModifier(actor) {
  // Fallback: calculate from spell DC
  const spellDC = actor.system?.attributes?.spellDC?.value;
  if (spellDC) {
    return spellDC - 10;
  }

  // Fallback: use class DC - 10
  const classDC = actor.system?.attributes?.classDC?.value;
  if (classDC) {
    return classDC - 10;
  }

  return 0;
}

/**
 * Counteract mode constants
 */
const COUNTERACT_MODE = {
  DISPEL: "dispel",      // Dispelling an ongoing effect (e.g., Dispel Magic)
  COUNTERSPELL: "counterspell"  // Countering a spell being cast
};

/**
 * Show mode selection dialog
 * @returns {Promise<string|null>} - The selected mode, or null if cancelled
 */
async function showModeSelection() {
  return new Promise((resolve) => {
    new Dialog({
      title: game.i18n.localize("COUNTERACT.ModeSelect.Title"),
      content: `
        <p style="margin-bottom: 1em;">${game.i18n.localize("COUNTERACT.ModeSelect.Prompt")}</p>
      `,
      buttons: {
        dispel: {
          icon: '<i class="fas fa-magic"></i>',
          label: game.i18n.localize("COUNTERACT.ModeSelect.DispelEffect"),
          callback: () => resolve(COUNTERACT_MODE.DISPEL)
        },
        counterspell: {
          icon: '<i class="fas fa-shield-alt"></i>',
          label: game.i18n.localize("COUNTERACT.ModeSelect.Counterspell"),
          callback: () => resolve(COUNTERACT_MODE.COUNTERSPELL)
        }
      },
      default: "dispel",
      close: () => resolve(null)
    }).render(true);
  });
}

/**
 * Main entry point - shows mode selection then opens appropriate dialog
 * @param {Object} options - Options to pass to CounteractDialog
 */
async function openCounteractDialog(options = {}) {
  // If mode is already specified (e.g., from chat card), skip selection
  if (options.mode) {
    new CounteractDialog(options).render(true);
    return;
  }

  const mode = await showModeSelection();
  if (!mode) return; // User cancelled

  new CounteractDialog({ ...options, mode }).render(true);
}

/**
 * Counteract Dialog Application
 */
class CounteractDialog extends FormApplication {
  constructor(options = {}) {
    super(options);
    // Mode: "dispel" (default) or "counterspell"
    this.mode = options.mode ?? COUNTERACT_MODE.DISPEL;
    // Pre-populated data from chat card
    this.preselectedActorId = options.actorId ?? null;
    this.preselectedSpellId = options.spellId ?? null;
    this.preselectedRank = options.castRank ?? null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "counteract-dialog",
      title: game.i18n.localize("COUNTERACT.DialogTitle"),
      template: `modules/${MODULE_ID}/templates/dialog.hbs`,
      classes: ["counteract-dialog", "pf2e"],
      width: 400,
      height: "auto",
      closeOnSubmit: false
    });
  }

  get title() {
    return this.mode === COUNTERACT_MODE.COUNTERSPELL
      ? game.i18n.localize("COUNTERACT.DialogTitleCounterspell")
      : game.i18n.localize("COUNTERACT.DialogTitle");
  }

  async getData() {
    const isCounterspell = this.mode === COUNTERACT_MODE.COUNTERSPELL;

    // Get selected and targeted tokens
    const selectedToken = canvas.tokens?.controlled?.[0];
    const targetedTokens = game.user?.targets;
    const targetToken = targetedTokens?.size > 0 ? targetedTokens.first() : null;

    // Get actors that can cast spells (owned by user)
    const actors = game.actors
      .filter(a => a.isOwner && (a.type === "character" || a.type === "npc"))
      .map(a => ({ id: a.id, name: a.name }));

    // Use preselected actor if provided, otherwise fall back to token/character
    const defaultActor = this.preselectedActorId
      ? game.actors.get(this.preselectedActorId)
      : (selectedToken?.actor ?? game.user?.character);

    // Get spells from default actor (for source spell selection)
    const spells = defaultActor ? getCounteractSpells(defaultActor) : [];

    // Get spellcasting modifier (use preselected spell's entry if available)
    const preselectedSpell = this.preselectedSpellId ? defaultActor?.items.get(this.preselectedSpellId) : null;
    const entryId = preselectedSpell?.system?.location?.value ?? null;
    const modifier = defaultActor ? getSpellcastingModifier(defaultActor, entryId) : 0;

    // Use preselected rank if provided
    const sourceRank = this.preselectedRank ?? preselectedSpell?.rank ?? 1;

    // Mode-specific data
    let targetEffects = [];
    let targetSpells = [];
    let targetDC = 15;
    let targetName = targetToken?.name ?? "";
    let hasTarget = !!targetToken;

    if (isCounterspell && targetToken?.actor) {
      // Counterspell mode: target is the caster, get their spells
      const targetActor = targetToken.actor;
      targetDC = getSpellDC(targetActor);

      // Get target's spells, with recently cast ones first
      const recentCasts = getRecentlyCastSpells(targetActor);
      const allSpells = getSpellsFromActor(targetActor);

      // Sort: recently cast spells first, then alphabetically
      const recentIds = new Set(recentCasts.map(s => s.id));
      targetSpells = [
        ...recentCasts.map(recent => {
          const spell = allSpells.find(s => s.id === recent.id);
          return spell ? { ...spell, recentlyCast: true, castRank: recent.rank } : null;
        }).filter(Boolean),
        ...allSpells.filter(s => !recentIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name))
      ];
    } else if (!isCounterspell) {
      // Dispel mode: get effects on target
      targetEffects = targetToken ? getEffectsOnToken(targetToken) : [];
    }

    return {
      mode: this.mode,
      isCounterspell,
      actors,
      spells,
      targetEffects,
      targetSpells,
      defaultActorId: defaultActor?.id ?? "",
      defaultSpellId: this.preselectedSpellId ?? "",
      defaultSourceRank: sourceRank,
      defaultModifier: modifier,
      targetName,
      targetDC,
      hasTarget,
      rankOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Actor selection change
    html.find('select[name="actorId"]').on("change", async (event) => {
      const actorId = event.target.value;
      const actor = game.actors.get(actorId);

      // Update spells dropdown
      const spells = actor ? getCounteractSpells(actor) : [];
      const spellSelect = html.find('select[name="spellId"]');
      spellSelect.empty();
      spellSelect.append('<option value="">-- Select Spell --</option>');
      for (const spell of spells) {
        const label = `${spell.name} (Rank ${spell.rank})${spell.hasCounteractTrait ? " [Counteract]" : ""}`;
        const opt = document.createElement('option');
        opt.value = spell.id;
        opt.dataset.rank = spell.rank;
        opt.dataset.entryId = spell.entryId ?? "";
        opt.textContent = label;
        spellSelect.append(opt);
      }

      // Reset modifier to first entry (will update when spell is selected)
      const modifier = actor ? getSpellcastingModifier(actor) : 0;
      html.find('input[name="modifier"]').val(modifier);
    });

    // Spell selection change - update rank and modifier based on spell's entry
    html.find('select[name="spellId"]').on("change", (event) => {
      const option = event.target.selectedOptions[0];
      const rank = option?.dataset?.rank ?? 1;
      const entryId = option?.dataset?.entryId || null;
      html.find('select[name="sourceRank"]').val(rank);

      // Update modifier based on the spell's spellcasting entry
      const actorId = html.find('select[name="actorId"]').val();
      const actor = game.actors.get(actorId);
      if (actor) {
        const modifier = getSpellcastingModifier(actor, entryId);
        html.find('input[name="modifier"]').val(modifier);
      }
    });

    // Target effect selection change (dispel mode)
    html.find('select[name="targetEffectId"]').on("change", (event) => {
      const option = event.target.selectedOptions[0];

      // If "Manual Input" is selected, reset to defaults with fallback DC
      if (option?.value === "manual") {
        html.find('select[name="targetRank"]').val(1);
        html.find('input[name="targetName"]').val("");
        html.find('input[name="targetDC"]').val(SPELL_RANK_DC[1] ?? 15);
        return;
      }

      const rank = option?.dataset?.rank ?? 1;
      const dc = option?.dataset?.dc ?? 15;
      const name = option?.dataset?.name ?? "";
      html.find('select[name="targetRank"]').val(rank);
      html.find('input[name="targetDC"]').val(dc);
      if (name) {
        html.find('input[name="targetName"]').val(name);
      }
    });

    // Target spell selection change (counterspell mode)
    html.find('select[name="targetSpellId"]').on("change", (event) => {
      const option = event.target.selectedOptions[0];

      // If "Manual Input" is selected, clear the auto-filled fields for fresh entry
      // and set DC from fallback table
      if (option?.value === "manual") {
        html.find('select[name="targetRank"]').val(1);
        html.find('input[name="targetName"]').val("");
        html.find('input[name="targetDC"]').val(SPELL_RANK_DC[1] ?? 15);
        return;
      }

      if (!option || option.value === "") return;

      const rank = option?.dataset?.rank ?? 1;
      const spellName = option?.textContent?.split(" (")[0] ?? "";
      html.find('select[name="targetRank"]').val(rank);
      html.find('input[name="targetName"]').val(spellName);
      // Don't update DC here - counterspell mode uses target's spell DC which is already set
    });

    // Target rank change - auto-populate DC from fallback table
    // This helps GMs who don't know the original caster's DC
    html.find('select[name="targetRank"]').on("change", (event) => {
      const rank = parseInt(event.target.value) || 1;
      const fallbackDC = SPELL_RANK_DC[rank] ?? 15;
      html.find('input[name="targetDC"]').val(fallbackDC);
    });

    // Refresh target button
    html.find('button[name="refreshTarget"]').on("click", async () => {
      await this.render(true);
    });

    // Roll button
    html.find('button[name="rollCounteract"]').on("click", async () => {
      await this._performCounteractCheck(html);
    });
  }

  async _performCounteractCheck(html) {
    const form = html.find("form")[0] ?? html[0];
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Validate actor selection
    const actor = game.actors.get(data.actorId);
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("COUNTERACT.Warnings.NoActor"));
      return;
    }

    // Parse and validate numeric inputs
    const sourceRank = Math.max(1, Math.min(10, parseInt(data.sourceRank) || 1));
    const targetRank = Math.max(1, Math.min(10, parseInt(data.targetRank) || 1));
    const modifier = parseInt(data.modifier) || 0;
    const targetDC = Math.max(1, parseInt(data.targetDC) || 15);
    const targetName = data.targetName || "Unknown Effect";

    // Get spell for display
    const spell = actor.items.get(data.spellId);

    // Roll the d20
    let roll;
    try {
      roll = new Roll("1d20 + @mod", { mod: modifier });
      await roll.evaluate();
    } catch (error) {
      console.error(`${MODULE_ID} | Roll evaluation failed:`, error);
      ui.notifications.error(game.i18n.localize("COUNTERACT.Errors.RollFailed"));
      return;
    }
    // Use neutral value (10) as fallback to avoid nat 1/20 logic issues
    const dieResult = roll.dice?.[0]?.results?.[0]?.result ?? 10;
    const total = roll.total;

    // Determine degree of success
    const degreeOfSuccess = getDegreeOfSuccess(total, targetDC, dieResult);

    // Check if counteract succeeds
    const result = checkCounteract(sourceRank, targetRank, degreeOfSuccess);

    // Prepare chat message data
    const chatData = {
      actorName: actor.name,
      spellName: spell?.name ?? "Counteract",
      sourceRank,
      targetName,
      targetRank,
      targetDC,
      roll: total,
      dieResult,
      modifier,
      degreeOfSuccess,
      degreeLabel: game.i18n.localize(`COUNTERACT.Degree.${degreeOfSuccess}`),
      success: result.success,
      threshold: result.threshold,
      resultLabel: result.success
        ? game.i18n.localize("COUNTERACT.Result.Counteracted")
        : game.i18n.localize("COUNTERACT.Result.Failed")
    };

    // Render chat card
    const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/chat-card.hbs`, chatData);

    await ChatMessage.create({
      author: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      sound: CONFIG.sounds.dice
    });

    // Close dialog after successful roll
    this.close();
  }

  async _updateObject(event, formData) {
    // Form submission handled by button click
  }
}

/**
 * Module Initialization
 */
Hooks.once("init", async () => {
  console.log(`${MODULE_ID} | Initializing PF2e Counteract Automation`);

  // Register module settings
  game.settings.register(MODULE_ID, "showSceneButton", {
    name: "COUNTERACT.Settings.ShowSceneButton.Name",
    hint: "COUNTERACT.Settings.ShowSceneButton.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showReadyNotification", {
    name: "COUNTERACT.Settings.ShowReadyNotification.Name",
    hint: "COUNTERACT.Settings.ShowReadyNotification.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | PF2e Counteract Automation Ready`);

  // Expose global API for macro use
  game.counteract = {
    open: (options) => openCounteractDialog(options),
    openDispel: () => openCounteractDialog({ mode: COUNTERACT_MODE.DISPEL }),
    openCounterspell: () => openCounteractDialog({ mode: COUNTERACT_MODE.COUNTERSPELL }),
    checkCounteract,
    calculateCounteractRank,
    calculateCounteractDC,
    getEffectsOnToken,
    getCounteractSpells,
    getSpellDC,
    getRecentlyCastSpells,
    DEGREE,
    MODE: COUNTERACT_MODE
  };

  // Notify that module is ready
  if (game.settings.get(MODULE_ID, "showReadyNotification")) {
    ui.notifications.info(game.i18n.localize("COUNTERACT.ModuleReady"));
  }
});

// Inject our counteract button into spell chat cards
Hooks.on("renderChatMessageHTML", (message, html) => {
  // Find PF2e's counteract button
  const pf2eButton = html.querySelector('button[data-action="spell-counteract"]');
  if (!pf2eButton) return;

  // Hide the original button
  pf2eButton.hidden = true;

  // PF2e resolves the cast spell (heightened, with variants) from the message flags
  const spell = message.item;
  const actor = spell?.actor ?? message.actor;
  const castRank = Number(message.flags?.pf2e?.origin?.castRank) || spell?.rank || 1;

  // Create our replacement button, keeping PF2e's classes so it styles like the card
  const ourButton = document.createElement("button");
  ourButton.type = "button";
  ourButton.className = `${pf2eButton.className} counteract-plugin-btn`.trim();
  ourButton.dataset.visibility = "owner";
  ourButton.innerHTML = `<i class="fa-solid fa-ban"></i> ${game.i18n.localize("COUNTERACT.ChatCard.CounteractButton")}`;

  ourButton.addEventListener("click", () => {
    new CounteractDialog({
      actorId: actor?.id,
      spellId: spell?.id,
      castRank
    }).render(true);
  });

  // Insert our button where the original was
  pf2eButton.after(ourButton);
});

// Add scene control button for quick access
// Since v13, controls and their tools are objects keyed by name; titles auto-localize
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.settings.get(MODULE_ID, "showSceneButton")) return;

  if (controls.tokens?.tools) {
    controls.tokens.tools.counteract = {
      name: "counteract",
      title: "COUNTERACT.SceneControl.Title", // v13 auto-localizes
      icon: "fa-solid fa-ban",
      button: true,
      onChange: () => {
        if (game.counteract) {
          game.counteract.open();
        } else {
          ui.notifications.warn(game.i18n.localize("COUNTERACT.Warnings.NotReady"));
        }
      }
    };
  }
});

export {
  CounteractDialog,
  openCounteractDialog,
  checkCounteract,
  calculateCounteractRank,
  calculateCounteractDC,
  getSpellDC,
  getRecentlyCastSpells,
  DEGREE,
  COUNTERACT_MODE
};
