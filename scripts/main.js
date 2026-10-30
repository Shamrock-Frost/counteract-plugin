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

  // Beating the DC by 10 is a critical success; missing it by 10 is a critical failure
  if (difference >= 10) {
    degree = DEGREE.CRITICAL_SUCCESS;
  } else if (difference >= 0) {
    degree = DEGREE.SUCCESS;
  } else if (difference > -10) {
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
 * The minimum total needed to reach each degree of success against a DC
 */
const DEGREE_MIN_TOTAL = {
  [DEGREE.FAILURE]: (dc) => dc - 9,
  [DEGREE.SUCCESS]: (dc) => dc,
  [DEGREE.CRITICAL_SUCCESS]: (dc) => dc + 10
};

/**
 * Work out what a counteract check needs before it is rolled
 * @param {Object} check - { sourceRank, targetRank, modifier, dc }
 * @returns {Object} - { possible, degree, total, chance } where degree is the
 *   lowest degree of success that counteracts and chance is a percentage
 */
function previewCounteract({ sourceRank, targetRank, modifier, dc }) {
  const degree = [DEGREE.FAILURE, DEGREE.SUCCESS, DEGREE.CRITICAL_SUCCESS]
    .find(d => checkCounteract(sourceRank, targetRank, d).success) ?? null;
  if (!degree) return { possible: false, degree: null, total: null, chance: 0 };

  // Count the d20 faces that counteract, including natural 1 and 20 adjustments
  let faces = 0;
  for (let die = 1; die <= 20; die++) {
    const result = getDegreeOfSuccess(die + modifier, dc, die);
    if (checkCounteract(sourceRank, targetRank, result).success) faces++;
  }
  return { possible: true, degree, total: DEGREE_MIN_TOTAL[degree](dc), chance: faces * 5 };
}

/**
 * The actors a user can counteract with: their owned characters and NPCs, plus
 * the actors of controlled tokens (unlinked NPC tokens aren't in game.actors)
 * @returns {Actor[]}
 */
function getSourceActors() {
  const actors = new Map();
  for (const token of canvas.tokens?.controlled ?? []) {
    if (token.actor?.isOwner) actors.set(token.actor.uuid, token.actor);
  }
  const owned = game.actors
    .filter(a => a.isOwner && (a.type === "character" || a.type === "npc"))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "character" ? -1 : 1));
  for (const actor of owned) actors.set(actor.uuid, actor);
  return [...actors.values()];
}

/**
 * Counteract window: pick what you're counteracting with and what you're
 * counteracting, preview the odds, roll
 */
class CounteractDialog extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(options = {}) {
    super(options);
    const actor = (options.actorUuid && fromUuidSync(options.actorUuid))
      ?? (options.actorId && game.actors.get(options.actorId))
      ?? canvas.tokens?.controlled?.[0]?.actor
      ?? game.user?.character
      ?? null;
    const spell = options.spellId ? actor?.items.get(options.spellId) : null;

    this.check = {
      mode: options.mode ?? game.settings.get(MODULE_ID, "lastMode") ?? COUNTERACT_MODE.DISPEL,
      actorUuid: actor?.uuid ?? "",
      spellId: spell?.id ?? "",
      sourceRank: options.castRank ?? spell?.rank ?? 1,
      modifier: actor ? getSpellcastingModifier(actor, spell?.system?.location?.value ?? null) : 0
    };
    this.#readTarget();
  }

  static DEFAULT_OPTIONS = {
    id: "counteract-dialog",
    tag: "form",
    classes: ["counteract-dialog"],
    window: { icon: "fa-solid fa-ban", contentClasses: ["standard-form"] },
    position: { width: 440, height: "auto" },
    form: { closeOnSubmit: false },
    actions: {
      roll: CounteractDialog.#onRoll
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/dialog.hbs` },
    footer: { template: `modules/${MODULE_ID}/templates/dialog-footer.hbs` }
  };

  get title() {
    return game.i18n.localize(this.check.mode === COUNTERACT_MODE.COUNTERSPELL
      ? "COUNTERACT.DialogTitleCounterspell"
      : "COUNTERACT.DialogTitle");
  }

  get isCounterspell() {
    return this.check.mode === COUNTERACT_MODE.COUNTERSPELL;
  }

  get actor() {
    return this.check.actorUuid ? fromUuidSync(this.check.actorUuid) : null;
  }

  /**
   * Read the current target token and reset the target fields from it
   */
  #readTarget() {
    const token = game.user?.targets?.first() ?? null;
    this.targetToken = token;
    Object.assign(this.check, {
      targetPick: "",
      targetName: "",
      targetRank: 1,
      // Counterspell defaults to the caster's spell DC; dispel waits for an effect
      targetDC: this.isCounterspell && token?.actor ? (getSpellDC(token.actor) || SPELL_RANK_DC[1]) : SPELL_RANK_DC[1],
      dcSource: this.isCounterspell && token?.actor && getSpellDC(token.actor) ? "caster" : "table"
    });
  }

  /** The options offered for the target: effects (dispel) or the caster's spells (counterspell) */
  #targetOptions() {
    const actor = this.targetToken?.actor;
    if (!actor) return [];
    if (!this.isCounterspell) return getEffectsOnToken(this.targetToken);

    const recent = getRecentlyCastSpells(actor);
    const recentIds = new Set(recent.map(s => s.id));
    const known = getSpellsFromActor(actor);
    return [
      ...recent.map(r => ({ ...known.find(s => s.id === r.id), rank: r.rank, recentlyCast: true })).filter(s => s.id),
      ...known.filter(s => !recentIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name))
    ];
  }

  async _prepareContext(options) {
    const actor = this.actor;
    const spells = actor ? getSpellsFromActor(actor) : [];
    const targetOptions = this.#targetOptions();
    const { sourceRank, targetRank, modifier, targetDC } = this.check;
    const preview = previewCounteract({ sourceRank, targetRank, modifier, dc: targetDC });

    return {
      ...this.check,
      isCounterspell: this.isCounterspell,
      actor,
      actors: getSourceActors().map(a => ({ uuid: a.uuid, name: a.name })),
      counteractSpells: spells.filter(s => s.hasCounteractTrait),
      otherSpells: spells.filter(s => !s.hasCounteractTrait),
      target: this.targetToken ? { name: this.targetToken.name, img: this.targetToken.document.texture.src } : null,
      recentSpells: targetOptions.filter(o => o.recentlyCast),
      targetOptions: targetOptions.filter(o => !o.recentlyCast),
      rankOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      modifierLabel: modifier >= 0 ? `+${modifier}` : `${modifier}`,
      dcHint: game.i18n.localize(`COUNTERACT.Dialog.DCSource.${this.check.dcSource}`),
      preview: {
        ...preview,
        degreeLabel: preview.degree ? game.i18n.localize(`COUNTERACT.Degree.${preview.degree}`) : "",
        tone: !preview.possible ? "impossible" : preview.chance >= 65 ? "good" : preview.chance >= 35 ? "fair" : "poor"
      }
    };
  }

  /**
   * Keep the state in step with the form, filling in dependent fields
   * (choosing a spell sets its rank, choosing an effect sets its rank and DC)
   */
  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);
    const input = event.target;
    const value = input.value;
    const state = this.check;

    switch (input.name) {
      case "mode":
        state.mode = value;
        game.settings.set(MODULE_ID, "lastMode", value);
        this.#readTarget();
        break;
      case "actorUuid": {
        state.actorUuid = value;
        state.spellId = "";
        state.sourceRank = 1;
        const actor = this.actor;
        state.modifier = actor ? getSpellcastingModifier(actor) : 0;
        break;
      }
      case "spellId": {
        state.spellId = value;
        const spell = this.actor?.items.get(value);
        if (spell) {
          state.sourceRank = spell.rank ?? 1;
          state.modifier = getSpellcastingModifier(this.actor, spell.system?.location?.value ?? null);
        }
        break;
      }
      case "targetPick": {
        state.targetPick = value;
        const option = this.#targetOptions().find(o => o.id === value);
        if (!option) {
          state.targetName = "";
          break;
        }
        state.targetName = option.name;
        state.targetRank = option.rank;
        if (!this.isCounterspell) {
          state.targetDC = option.dc;
          state.dcSource = option.dcSource;
        }
        break;
      }
      case "targetRank":
        state.targetRank = Number(value) || 1;
        // Follow the rank with the fallback table unless the DC came from somewhere real
        if (state.dcSource === "table") state.targetDC = calculateCounteractDC(state.targetRank);
        break;
      case "targetDC":
        state.targetDC = Math.max(1, Number(value) || 1);
        state.dcSource = "manual";
        break;
      case "sourceRank":
        state.sourceRank = Number(value) || 1;
        break;
      case "modifier":
        state.modifier = Number(value) || 0;
        break;
      case "targetName":
        state.targetName = value;
        return; // nothing depends on the name
    }
    this.render();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // The title follows the mode
    const title = this.window?.title;
    if (title) title.textContent = this.title;
  }

  /** Re-read the target when the user targets a different token */
  refreshTarget() {
    this.#readTarget();
    this.render();
  }

  static async #onRoll(event, target) {
    const actor = this.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("COUNTERACT.Warnings.NoActor"));
      return;
    }

    const state = this.check;
    const sourceRank = Math.clamp(Number(state.sourceRank) || 1, 1, 10);
    const targetRank = Math.clamp(Number(state.targetRank) || 1, 1, 10);
    const modifier = Number(state.modifier) || 0;
    const targetDC = Math.max(1, Number(state.targetDC) || 15);
    const targetName = state.targetName || game.i18n.localize("COUNTERACT.ChatCard.UnknownTarget");
    const spell = actor.items.get(state.spellId);

    let roll;
    try {
      roll = await new Roll("1d20 + @mod", { mod: modifier }).evaluate();
    } catch (error) {
      console.error(`${MODULE_ID} | Roll evaluation failed:`, error);
      ui.notifications.error(game.i18n.localize("COUNTERACT.Errors.RollFailed"));
      return;
    }
    // Use neutral value (10) as fallback to avoid nat 1/20 logic issues
    const dieResult = roll.dice?.[0]?.results?.[0]?.result ?? 10;
    const degreeOfSuccess = getDegreeOfSuccess(roll.total, targetDC, dieResult);
    const result = checkCounteract(sourceRank, targetRank, degreeOfSuccess);

    // A successful dispel against a known effect can be removed from the chat card
    const effect = !this.isCounterspell && state.targetPick
      ? this.targetToken?.actor?.items.get(state.targetPick)
      : null;

    const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/chat-card.hbs`, {
      isCounterspell: this.isCounterspell,
      spellName: spell?.name ?? game.i18n.localize("COUNTERACT.ChatCard.Title"),
      spellImg: spell?.img ?? "icons/svg/cancel.svg",
      sourceRank,
      targetName,
      targetImg: effect?.img ?? null,
      targetRank,
      targetDC,
      total: roll.total,
      dieResult,
      modifierLabel: modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`,
      isNat: dieResult === 20 ? "nat20" : dieResult === 1 ? "nat1" : "",
      degreeOfSuccess,
      degreeLabel: game.i18n.localize(`COUNTERACT.Degree.${degreeOfSuccess}`),
      success: result.success,
      resultLabel: game.i18n.localize(result.success ? "COUNTERACT.Result.Counteracted" : "COUNTERACT.Result.Failed"),
      explanation: result.threshold === null
        ? game.i18n.localize("COUNTERACT.Result.ExplainCritFail")
        : game.i18n.format("COUNTERACT.Result.Explain", {
          degree: game.i18n.localize(`COUNTERACT.Degree.${degreeOfSuccess}`),
          threshold: Math.max(result.threshold, 0),
          rank: targetRank
        }),
      canRemove: result.success && !!effect
    });

    await ChatMessage.create({
      author: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      sound: CONFIG.sounds.dice,
      flags: {
        [MODULE_ID]: {
          effectUuid: result.success && effect ? effect.uuid : null
        }
      }
    });

    this.close();
  }
}

/**
 * Open the counteract window, replacing one that is already open
 * @param {Object} options - mode, actorUuid/actorId, spellId, castRank
 */
async function openCounteractDialog(options = {}) {
  await foundry.applications.instances.get("counteract-dialog")?.close();
  return new CounteractDialog(options).render({ force: true });
}

/**
 * Module Initialization
 */
Hooks.once("init", () => {
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
    default: false
  });

  // The mode the window opens in, remembered from last time
  game.settings.register(MODULE_ID, "lastMode", {
    scope: "client",
    config: false,
    type: String,
    default: COUNTERACT_MODE.DISPEL
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
    previewCounteract,
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

// Follow the user's target while the window is open
Hooks.on("targetToken", (user) => {
  if (user !== game.user) return;
  foundry.applications.instances.get("counteract-dialog")?.refreshTarget();
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  // Our result card: wire up the remove-effect button
  const removeButton = html.querySelector("button[data-counteract-remove]");
  if (removeButton) {
    const effectUuid = message.flags?.[MODULE_ID]?.effectUuid;
    const effect = effectUuid ? fromUuidSync(effectUuid) : null;
    if (!effect?.isOwner) {
      // Already removed, or this user can't remove it
      removeButton.disabled = true;
      if (!effect) removeButton.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize("COUNTERACT.ChatCard.Removed")}`;
      else removeButton.hidden = true;
    } else {
      removeButton.addEventListener("click", async () => {
        removeButton.disabled = true;
        await effect.delete();
        ui.chat.updateMessage?.(message);
      });
    }
    return;
  }

  // PF2e spell card: swap its counteract button for ours
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
    openCounteractDialog({
      // Counteraction spells (Dispel Magic, Cleanse Affliction...) end ongoing effects
      mode: COUNTERACT_MODE.DISPEL,
      actorUuid: actor?.uuid,
      spellId: spell?.id,
      castRank
    });
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
      title: "COUNTERACT.SceneControl.Title",
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
  previewCounteract,
  calculateCounteractRank,
  calculateCounteractDC,
  getSpellDC,
  getRecentlyCastSpells,
  DEGREE,
  COUNTERACT_MODE
};
