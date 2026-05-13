/*
 * Alternate Character Field's Extension for SillyTavern
 * Based on: https://github.com/nbrown725/SillyTavern-AlternateDescriptions
 * Licensed under AGPLv3
 */

import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { ARGUMENT_TYPE, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue, enumTypes } from '../../../slash-commands/SlashCommandEnumValue.js';
let autoLinkEventHooksRegistered = false;
const manualFieldEditTimes = {};
const manualFieldSaveTimeouts = {};
const contextNotesSaveTimeouts = {};
const autoFieldUpdateVersions = {};
const MANUAL_EDIT_GRACE_MS = 1000;


const fieldConfigs = [
    {
        field: 'description',
        button_name: 'Descriptions',
        selector: '#description_div',
        inject_point: '#character_open_media_overrides',
        textarea: 'description_textarea',
        saveKey: 'alt_descriptions',
    },
    {
        field: 'personality',
        button_name: 'Personalities',
        selector: '#personality_div',
        inject_point: '.notes-link',
        textarea: 'personality_textarea',
        saveKey: 'alt_personalities',
    },
    {
        field: 'scenario',
        button_name: 'Scenarios',
        selector: '#scenario_div',
        inject_point: '.notes-link',
        textarea: 'scenario_pole',
        saveKey: 'alt_scenarios',
    },
    {
        field: 'example dialogue',
        button_name: 'Example Dialogue',
        selector: '#mes_example_div',
        inject_point: '.editor_maximize',
        textarea: 'mes_example_textarea',
        saveKey: 'alt_example_dialogue',
    },
    {
        field: 'main prompt',
        button_name: 'Main Prompts',
        selector: '#system_prompt_textarea',
        inject_point: '.editor_maximize',
        textarea: 'system_prompt_textarea',
        saveKey: 'alt_main_prompts',
    },
    {
        field: 'post-history instructions',
        button_name: 'Post-History Instructions',
        selector: '#post_history_instructions_textarea',
        inject_point: '.editor_maximize',
        textarea: 'post_history_instructions_textarea',
        saveKey: 'alt_post_history',
    }
]

const fieldStorageKeys = {
    'description': { rootKey: 'description', dataKey: 'description' },
    'personality': { rootKey: 'personality', dataKey: 'personality' },
    'scenario': { rootKey: 'scenario', dataKey: 'scenario' },
    'example dialogue': { rootKey: 'mes_example', dataKey: 'mes_example' },
    'main prompt': { rootKey: null, dataKey: 'system_prompt' },
    'post-history instructions': { rootKey: null, dataKey: 'post_history_instructions' },
};

function getFieldStorageKeys(field) {
    return fieldStorageKeys[field.field] || {};
}

function getCurrentGreetingNumber() {
    const context = SillyTavern.getContext();
    const swipeId = Number(context.chat?.[0]?.swipe_id);
    if (!Number.isNaN(swipeId)) return swipeId + 1;

    const firstMessage = document.querySelector('#chat .mes:first-child');
    const counter = firstMessage?.querySelector('.swipes-counter');
    const match = counter?.textContent.replace(/\u200B/g, '').trim().match(/^(\d+)/);
    return match ? parseInt(match[1]) : null;
}

function scheduleAutoLinkCheck(delay = 0) {
    setTimeout(() => {
        const greetingNumber = getCurrentGreetingNumber();
        if (!greetingNumber) return;

        try {
            checkAutoLinks(greetingNumber);
            if (typeof displayContextNotes === 'function') displayContextNotes();
        } catch (error) {
            console.error('[AltFields] Failed to re-apply greeting binds:', error);
        }
    }, delay);
}

function getCurrentGreetingBindings() {
    const greetingNumber = getCurrentGreetingNumber();
    if (!greetingNumber) return null;

    const context = SillyTavern.getContext();
    const characterId = ContextUtil.getCharacterId();
    const character = context.characters?.[characterId];
    const greetingBinds = character?.data?.extensions?.greeting_binds;
    if (!greetingBinds) return null;

    return greetingBinds[parseInt(greetingNumber) - 1] || null;
}

function isManualFieldEditActive(field) {
    const lastEdit = manualFieldEditTimes[field.saveKey] || 0;
    return Date.now() - lastEdit < MANUAL_EDIT_GRACE_MS;
}

function getNextAutoFieldUpdateVersion(field) {
    autoFieldUpdateVersions[field.saveKey] = (autoFieldUpdateVersions[field.saveKey] || 0) + 1;
    return autoFieldUpdateVersions[field.saveKey];
}

function isLatestAutoFieldUpdate(field, version) {
    return autoFieldUpdateVersions[field.saveKey] === version;
}

function saveValueToBoundEntry(field, value, bindings = getCurrentGreetingBindings(), save = true) {
    const boundIndex = bindings?.[field.saveKey];
    if (boundIndex === undefined) return false;

    const fieldData = ContextUtil.getFieldData(field);
    const boundEntry = fieldData[boundIndex];
    if (!boundEntry) return false;

    if (boundEntry.content === value) return true;

    boundEntry.content = value;
    if (save) saveFieldData(field, fieldData);
    return true;
}

function isCurrentGreetingBoundToFieldIndex(field, index) {
    const bindings = getCurrentGreetingBindings();
    return bindings?.[field.saveKey] === index;
}

function adjustGreetingBindsAfterDelete(field, deletedIndex) {
    const context = SillyTavern.getContext();
    const characterId = ContextUtil.getCharacterId();
    const character = context.characters?.[characterId];
    const greetingBinds = character?.data?.extensions?.greeting_binds;
    if (!greetingBinds) return;

    let changed = false;
    Object.values(greetingBinds).forEach(bindings => {
        if (!bindings || typeof bindings !== 'object') return;

        const boundIndex = bindings[field.saveKey];
        if (boundIndex === undefined) return;

        if (boundIndex === deletedIndex) {
            delete bindings[field.saveKey];
            changed = true;
        } else if (boundIndex > deletedIndex) {
            bindings[field.saveKey] = boundIndex - 1;
            changed = true;
        }
    });

    if (changed) {
        character.data.extensions.greeting_binds = greetingBinds;
        context.writeExtensionField(characterId, 'greeting_binds', greetingBinds);
    }
}

function adjustGreetingBindsAfterMove(field, fromIndex, toIndex) {
    const context = SillyTavern.getContext();
    const characterId = ContextUtil.getCharacterId();
    const character = context.characters?.[characterId];
    const greetingBinds = character?.data?.extensions?.greeting_binds;
    if (!greetingBinds) return;

    let changed = false;
    Object.values(greetingBinds).forEach(bindings => {
        if (!bindings || typeof bindings !== 'object') return;

        if (bindings[field.saveKey] === fromIndex) {
            bindings[field.saveKey] = toIndex;
            changed = true;
        } else if (bindings[field.saveKey] === toIndex) {
            bindings[field.saveKey] = fromIndex;
            changed = true;
        }
    });

    if (changed) {
        character.data.extensions.greeting_binds = greetingBinds;
        context.writeExtensionField(characterId, 'greeting_binds', greetingBinds);
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getContextNotesData(character) {
    if (!character.data.extensions) character.data.extensions = {};
    if (!character.data.extensions.context_notes_per_greeting) character.data.extensions.context_notes_per_greeting = {};
    return character.data.extensions.context_notes_per_greeting;
}

function saveContextNotesData(characterId, character, notesData) {
    if (!character.data.extensions) character.data.extensions = {};
    character.data.extensions.context_notes_per_greeting = notesData;
    SillyTavern.getContext().writeExtensionField(characterId, 'context_notes_per_greeting', notesData);
}

function scopeFormattedContextStyles(html) {
    return String(html).replace(/<style>([\s\S]*?)<\/style>/gi, (_, css) => {
        const scopedCss = css.replaceAll('.mes_text ', '#context-notes-display .context-content ');
        return `<style>${scopedCss}</style>`;
    });
}

// Utility functions for handling character context
class ContextUtil {
    static getCharacterId() {
        const context = SillyTavern.getContext();
        let characterId = context.characterId;
        if (context.groupId) {
            const avatarUrlInput = document.getElementById('avatar_url_pole');
            if (avatarUrlInput instanceof HTMLInputElement) {
                const avatarUrl = avatarUrlInput.value;
                characterId = context.characters.findIndex(c => c.avatar === avatarUrl);
            }
        }
        return characterId;
    }

    static getName() {
        const context = SillyTavern.getContext();
        if (context.menuType === 'create') {
            return context.createCharacterData.name || 'Unknown';
        } else {
            const characterId = ContextUtil.getCharacterId();
            return context.characters[characterId]?.data?.name || 'Unknown';
        }
    }

    static migrateDescriptions() {
        const context = SillyTavern.getContext();
        if (context.menuType !== "create") {
            const characterId = ContextUtil.getCharacterId();
            let desc = context.characters[characterId]?.data?.extensions?.alternate_descriptions;
            if (desc && desc.length !== 0) {
                if (typeof (desc[0]) === "string") {
                    desc = desc.map((description, index) => ({ title: `Description #${index + 1}`, content: description }));
                } else if (desc[0].description) {
                    desc = desc.map(item => ({ title: item.title, content: item.description }));
                }
                saveFieldData(fieldConfigs[0], desc);
                delete context.characters[characterId].data.extensions.alternate_descriptions;
                context.writeExtensionField(characterId, 'alternate_descriptions', undefined);
            }
        }
    }

    static getFieldData(field) {
        this.migrateDescriptions();
        const context = SillyTavern.getContext();
        if (context.menuType === 'create') {
            return context.createCharacterData.extensions?.alternate_fields?.[field.saveKey] || [];
        } else {
            const characterId = ContextUtil.getCharacterId();
            return context.characters[characterId]?.data?.extensions?.alternate_fields?.[field.saveKey] || [];
        }
    }

    static getCurrentField(field) {
        const textarea = document.getElementById(field.textarea);
        return textarea ? textarea.value : '';
    }

    static setPromptFieldValue(field, entry) {
        const context = SillyTavern.getContext();
        const { rootKey, dataKey } = getFieldStorageKeys(field);

        if (context.menuType === 'create') {
            if (rootKey) context.createCharacterData[rootKey] = entry;
            if (dataKey) context.createCharacterData[dataKey] = entry;
            return;
        }

        const characterId = ContextUtil.getCharacterId();
        const character = context.characters?.[characterId];
        if (!character) return;

        if (rootKey) character[rootKey] = entry;
        if (dataKey) {
            if (!character.data) character.data = {};
            character.data[dataKey] = entry;
        }
    }

    static async setCurrentField(field, entry, silent = false) {
        const updateVersion = getNextAutoFieldUpdateVersion(field);
        ContextUtil.setPromptFieldValue(field, entry);
        const textarea = document.getElementById(field.textarea);
        
        if (textarea) {
            // 1. Force the visual update immediately
            textarea.value = entry;
            if (typeof $ !== 'undefined') $(textarea).val(entry);

            if (!silent) {
                // LOUD MODE: Trigger normal events (Use Button)
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                if (typeof $ !== 'undefined') $(textarea).trigger('input');
            } else {
                // NINJA MODE: keep prompt memory and the editor UI in sync without firing ST save handlers.
                const context = SillyTavern.getContext();
                const autoSetStartedAt = Date.now();
                const enforce = () => {
                    if (!isLatestAutoFieldUpdate(field, updateVersion)) return;

                    if ((manualFieldEditTimes[field.saveKey] || 0) > autoSetStartedAt) {
                        return;
                    }

                    ContextUtil.setPromptFieldValue(field, entry);
                    if (textarea.value !== entry) {
                        console.log(`[AltFields] Re-enforcing ${field.field} change.`);
                        textarea.value = entry;
                        if (typeof $ !== 'undefined') $(textarea).val(entry);
                    }
                };

                [50, 150, 300, 750, 1200, 1800].forEach(delay => setTimeout(enforce, delay));



                // C. Update Token Counter
                const wrapper = textarea.closest('.flex-container') || textarea.closest('div');
                if (wrapper) {
                    const counter = wrapper.querySelector('.token_counter') || wrapper.querySelector('.form_token_counter');
                    if (counter && context.getTokenCountAsync) {
                        const tokens = await context.getTokenCountAsync(entry);
                        counter.innerText = tokens + " Tokens";
                    }
                }
            }
        }
    }
}

// Save descriptions to character data
function saveFieldData(field, fieldData) {
    const context = SillyTavern.getContext();
    if (!fieldData) return;

    if (context.menuType === 'create') {
        if (!context.createCharacterData.extensions) context.createCharacterData.extensions = {};
        if (!context.createCharacterData.extensions.alternate_fields) context.createCharacterData.extensions.alternate_fields = {};
        context.createCharacterData.extensions.alternate_fields[field.saveKey] = fieldData;
    } else {
        const characterId = ContextUtil.getCharacterId();
        const character = context.characters[characterId];
        if (!character) return;

        if (!character.data.extensions) character.data.extensions = {};
        if (!character.data.extensions.alternate_fields) character.data.extensions.alternate_fields = {};
        character.data.extensions.alternate_fields[field.saveKey] = fieldData;

        context.writeExtensionField(characterId, 'alternate_fields', character.data.extensions.alternate_fields);
    }
}

// Check if current description matches any saved descriptions
function checkFieldStatus(container, field, fieldData) {
    const currentFieldEntry = ContextUtil.getCurrentField(field);
    const hasMatch = fieldData.some(entry => entry.content.trim() === currentFieldEntry.trim());

    let statusIndicator = container.querySelector('#field-status');
    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'field-status';
        statusIndicator.style.cssText = `margin: 10px 0; padding: 8px 12px; border-radius: 4px; font-size: 13px; display: flex; align-items: center; gap: 8px;`;
        const hr = container.querySelectorAll('hr')[1];
        hr.parentNode.insertBefore(statusIndicator, hr.nextSibling);
    }

    if (!hasMatch && currentFieldEntry.trim()) {
        statusIndicator.style.backgroundColor = 'rgba(255, 193, 7, 0.1)';
        statusIndicator.style.borderLeft = '3px solid #ffc107';
        statusIndicator.style.color = '#856404';
        statusIndicator.innerHTML = `<i class="fa-solid fa-exclamation-triangle"></i><span>Current ${field.field} has been modified and doesn't match any saved version.</span><div class="menu_button menu_button_icon" id="save-current-btn" style="margin-left: auto; font-size: 12px; padding: 4px 8px;"><i class="fa-solid fa-save"></i><span>Save Current</span></div>`;
        statusIndicator.querySelector('#save-current-btn').addEventListener('click', () => {
            fieldData.push( {title: `${field.field} #${fieldData.length+1}`, content: currentFieldEntry });
            saveFieldData(field, fieldData);
            updateFieldList(container, field, fieldData);
            checkFieldStatus(container, field, fieldData);
        });
    } else if (hasMatch) {
        statusIndicator.style.backgroundColor = 'rgba(40, 167, 69, 0.1)';
        statusIndicator.style.borderLeft = '3px solid #28a745';
        statusIndicator.style.color = '#155724';
        statusIndicator.innerHTML = `<i class="fa-solid fa-check-circle"></i><span>Current ${field.field} matches a saved version.</span>`;
    } else {
        statusIndicator.style.display = 'none';
    }
}

function updateActiveIndicators(container, field, fieldData) {
    const listContainer = container.querySelector('#field-list');
    const activeIndex = getActiveFieldIndex(field, fieldData);

    fieldData.forEach((entry, index) => {
        const isActive = index === activeIndex;
        const entryItem = listContainer.querySelector(`[data-item-index="${index}"]`);
        if (entryItem) {
            const activeIndicator = entryItem.querySelector('.active-indicator');
            const useBtn = entryItem.querySelector(`.use-field-btn`);
            if (isActive) {
                entryItem.classList.add('active-field');
                useBtn.style.opacity = '0.5';
                useBtn.title = 'Already active';
                activeIndicator.innerHTML = `<i class="fa-solid fa-check-circle" style="color: #28a745; margin-left: 8px;"></i>`;
            } else {
                entryItem.classList.remove('active-field');
                useBtn.style.opacity = '';
                useBtn.title = '';
                activeIndicator.innerHTML = '';
            }
        }
    });
    checkFieldStatus(container, field, fieldData);
}

function getActiveFieldIndex(field, fieldData) {
    const currentFieldEntry = ContextUtil.getCurrentField(field).trim();
    if (!currentFieldEntry) return -1;

    const bindings = getCurrentGreetingBindings();
    const boundIndex = bindings?.[field.saveKey];
    if (boundIndex !== undefined && fieldData[boundIndex]?.content.trim() === currentFieldEntry) {
        return Number(boundIndex);
    }

    return fieldData.findIndex(entry => entry.content.trim() === currentFieldEntry);
}

const saveTimeouts = {};

function updateFieldList(container, field, fieldData) {
    const listContainer = container.querySelector('#field-list');
    const currentFieldEntry = ContextUtil.getCurrentField(field);
    const context = SillyTavern.getContext();
    const getTokenCount = context.getTokenCountAsync;
    const activeIndex = getActiveFieldIndex(field, fieldData);

    if (fieldData.length === 0) {
        listContainer.innerHTML = `<strong>Click <i class="fa-solid fa-plus"></i> to save the current ${field.field}</strong>`;
        return;
    }

    listContainer.innerHTML = fieldData.map((entry, index) => {
        const isActive = index === activeIndex;
        const activeClass = isActive ? 'active-field' : '';
        const activeIndicator = isActive ? '<i class="fa-solid fa-check-circle" style="color: #28a745; margin-left: 8px;"></i>' : '';
        const textareaId = `alt_field_${field.saveKey}_${index}`;
        return `
            <div class="field-item alternate_greeting ${activeClass}" data-item-index="${index}">
                <details open>
                    <summary>
                        <div class="title_restorable gap5px">
                            <div class="flex-container alignItemsCenter alt-field-title-wrap">
                                <input class="text_pole textarea_compact field-title margin0" data-index="${index}" value="${escapeHtml(entry.title)}" placeholder="${field.field} title" maxlength="50">
                                <div class="active-indicator">${activeIndicator}</div>
                                <i class="editor_maximize fa-solid fa-maximize right_menu_button" title="Expand the editor" data-for="${textareaId}"></i>
                            </div>
                            <span class="expander"></span>
                            <div class="menu_button menu_button_icon use-field-btn" data-index="${index}" ${isActive ? 'style="opacity: 0.5;" title="Already active"' : 'title="Use this alternate"'}>
                                <i class="fa-solid fa-arrow-up"></i><span>Use</span>
                            </div>
                            <div class="menu_button menu_button_icon move-up-field-btn" data-index="${index}" title="Move up">
                                <i class="fa-solid fa-chevron-up"></i>
                            </div>
                            <div class="menu_button menu_button_icon move-down-field-btn" data-index="${index}" title="Move down">
                                <i class="fa-solid fa-chevron-down"></i>
                            </div>
                            <div class="menu_button menu_button_icon delete-field-btn" data-index="${index}">
                                <i class="fa-solid fa-trash"></i><span>Delete</span>
                            </div>
                        </div>
                    </summary>
                    <textarea id="${textareaId}" class="text_pole textarea_compact field-textarea mdHotkeys" rows="8" data-index="${index}" placeholder="${field.field}...">${escapeHtml(entry.content)}</textarea>
                    <div class="extension_token_counter">
                        <span>Tokens:</span> <span data-token-display="${index}">calculating...</span>
                    </div>
                </details>
            </div>`;
    }).join('');

    fieldData.forEach(async (entry, index) => {
        const tokenCount = await context.getTokenCountAsync(entry.content);
        const tokenDisplay = container.querySelector(`[data-token-display="${index}"]`);
        if (tokenDisplay) tokenDisplay.textContent = tokenCount;
    });

    listContainer.querySelectorAll('.use-field-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const index = parseInt(e.currentTarget.dataset.index);
            const currentFieldEntry = ContextUtil.getCurrentField(field);
            const hasUnsavedChanges = !fieldData.some(entry => entry.content.trim() === currentFieldEntry.trim()) && currentFieldEntry.trim();
            if (!hasUnsavedChanges || confirm(`Your current ${field.field} has unsaved changes. Switch anyway?`)) {
                ContextUtil.setCurrentField(field, fieldData[index].content); // Standard mode (silent=false)
                updateActiveIndicators(container, field, fieldData);
            }
        });
    });

    listContainer.querySelectorAll('.move-up-field-btn, .move-down-field-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const index = parseInt(e.currentTarget.dataset.index);
            const direction = e.currentTarget.classList.contains('move-up-field-btn') ? -1 : 1;
            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= fieldData.length) return;

            [fieldData[index], fieldData[newIndex]] = [fieldData[newIndex], fieldData[index]];
            adjustGreetingBindsAfterMove(field, index, newIndex);
            saveFieldData(field, fieldData);
            updateFieldList(container, field, fieldData);
            updateActiveIndicators(container, field, fieldData);
        });
    });

    listContainer.querySelectorAll('.delete-field-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (confirm(`Delete this alternate?`)) {
                const index = parseInt(e.currentTarget.dataset.index);
                adjustGreetingBindsAfterDelete(field, index);
                fieldData.splice(index, 1);
                saveFieldData(field, fieldData);
                updateFieldList(container, field, fieldData);
            }
        });
    });

    listContainer.querySelectorAll('.field-textarea').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            fieldData[index].content = e.target.value;
            if (isCurrentGreetingBoundToFieldIndex(field, index)) {
                manualFieldEditTimes[field.saveKey] = Date.now();
                ContextUtil.setCurrentField(field, e.target.value, true);
            }
            setTimeout(() => updateActiveIndicators(container, field, fieldData), 50);
            const timeoutKey = `${field.saveKey}:${index}:content`;
            if (saveTimeouts[timeoutKey]) clearTimeout(saveTimeouts[timeoutKey]);
            saveTimeouts[timeoutKey] = setTimeout(async () => {
                saveFieldData(field, fieldData);
                const tokenCount = await getTokenCount(fieldData[index].content);
                const tokenDisplay = container.querySelector(`[data-token-display="${index}"]`);
                if (tokenDisplay) tokenDisplay.textContent = tokenCount;
            }, 500);
        });
    });

    listContainer.querySelectorAll('.field-title').forEach(titleInput => {
        titleInput.addEventListener('click', e => e.stopPropagation());
        titleInput.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            fieldData[index].title = e.target.value;
            const timeoutKey = `${field.saveKey}:${index}:title`;
            if (saveTimeouts[timeoutKey]) clearTimeout(saveTimeouts[timeoutKey]);
            saveTimeouts[timeoutKey] = setTimeout(() => saveFieldData(field, fieldData), 500);
        });
    });
}

function setupFieldMonitoring(container, field, fieldData) {
    const mainTextarea = document.getElementById(field.textarea);
    if (mainTextarea) {
        checkFieldStatus(container, field, fieldData);
        const checkStatus = () => setTimeout(() => updateActiveIndicators(container, field, fieldData), 50);
        mainTextarea.addEventListener('input', checkStatus);
        mainTextarea.addEventListener('paste', checkStatus);
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && !document.contains(container)) {
                    mainTextarea.removeEventListener('input', checkStatus);
                    mainTextarea.removeEventListener('paste', checkStatus);
                    observer.disconnect();
                }
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

function createPopupContent(field) {
    const characterName = ContextUtil.getName();
    let fieldData = ContextUtil.getFieldData(field);
    let currentFieldEntry = ContextUtil.getCurrentField(field);

    if (fieldData.length === 0 && currentFieldEntry.trim()) {
        fieldData = [{ title: `${field.field} #1`, content: currentFieldEntry }];
        saveFieldData(field, fieldData);
    }

    const container = document.createElement('div');
    container.className = 'flex-container flexFlowColumn';  
    container.innerHTML = `
        <div class="flex-container justifySpaceBetween alignItemsCenter">
            <h3 class="margin0">Alternate ${field.button_name} for <span>${characterName}</span></h3>
            <div id="add-field-btn" class="menu_button menu_button_icon"><i class="fa-solid fa-plus"></i><span>Add New</span></div>
        </div>
        <hr>
        <div class="justifyLeft"><small>Save different versions of your character's ${field.field}.</small></div>
        <hr>
        <div id="field-list"></div>`;

    container.querySelector(`#add-field-btn`).addEventListener('click', () => {
        currentFieldEntry = ContextUtil.getCurrentField(field);
        fieldData.push(currentFieldEntry ? { title: `${field.field} #${fieldData.length + 1}`, content: currentFieldEntry } : { title: `${field.field} #${fieldData.length+1}`, content: ''});
        saveFieldData(field, fieldData);
        updateFieldList(container, field, fieldData);
    });

    updateFieldList(container, field, fieldData);
    setupFieldMonitoring(container, field, fieldData);
    return container;
}

function createButton(field) {
    const button = document.createElement('div');
    button.className = `menu_button menu_button_icon alt_${field.saveKey}_button alt_fields_button`;
    button.title = `Manage alternate ${field.field}s`;
    button.innerHTML = `<i class="fa-solid fa-bars-staggered"></i><span>Alt. ${field.button_name}</span>`;
    button.addEventListener('click', () => {
        const context = SillyTavern.getContext();
        const popupContent = createPopupContent(field);
        context.callPopup(popupContent, 'text', '', { wide: true, large: true });
    });
    return button;
}

function waitForElement(selector, callback) {
    const element = document.querySelector(selector);
    if (element) {
        callback(element);
    } else {
        setTimeout(() => waitForElement(selector, callback), 100);
    }
}

function registerManualFieldEditTracking() {
    fieldConfigs.forEach(field => {
        waitForElement(`#${field.textarea}`, (textarea) => {
            if (textarea.dataset.altFieldsManualTracking === 'true') return;

            textarea.dataset.altFieldsManualTracking = 'true';
            textarea.addEventListener('input', (event) => {
                if (event.isTrusted === false) return;

                manualFieldEditTimes[field.saveKey] = Date.now();
                const bindingsAtEdit = { ...(getCurrentGreetingBindings() || {}) };
                const editedValue = textarea.value;
                ContextUtil.setPromptFieldValue(field, textarea.value);

                if (manualFieldSaveTimeouts[field.saveKey]) {
                    clearTimeout(manualFieldSaveTimeouts[field.saveKey]);
                }

                manualFieldSaveTimeouts[field.saveKey] = setTimeout(() => {
                    saveValueToBoundEntry(field, editedValue, bindingsAtEdit, true);
                }, 600);
            });
        });
    });
}

function injectButtons() {
    fieldConfigs.forEach(field => {
        const containerSelector = field.selector.startsWith('#') && field.selector.includes('textarea') ? field.selector : field.selector;
        waitForElement(containerSelector, (element) => {
            const fieldButton = createButton(field);
            let parent, injectReference;
            if (field.selector.startsWith('#') && field.selector.includes('textarea')) {
                parent = element.closest('div');
                const sibling = parent.querySelector(field.inject_point);
                injectReference = sibling ? sibling.nextSibling : element;
                if (sibling) parent = sibling.parentNode;
            } else {
                parent = element;
                const sibling = parent.querySelector(field.inject_point);
                injectReference = sibling ? sibling.nextSibling : null;
                if (!sibling) {
                    if (field.field === 'description') {
                        const textArea = parent.querySelector('textarea');
                        if (textArea) {
                            injectReference = textArea;
                            if (textArea.parentNode !== parent) parent = textArea.parentNode;
                        } else {
                            injectReference = parent.firstChild;
                        }
                    } else {
                        injectReference = parent.firstChild;
                    }
                }
            }
            if (parent && injectReference) {
                if (parent.querySelector(`.alt_${field.saveKey}_button`)) return; 
                if (injectReference.parentNode === parent) {
                    parent.insertBefore(fieldButton, injectReference);
                } else {
                    parent.appendChild(fieldButton);
                }
            } else if (parent) {
                if (!parent.querySelector(`.alt_${field.saveKey}_button`)) parent.appendChild(fieldButton);
            }
        });
    });
    injectBindButton();
    injectContextButton();
}

function injectBindButton() {
    let attempts = 0;
    const maxAttempts = 20;
    const tryInject = setInterval(() => {
        attempts++;
        if (document.getElementById('alt_binds_button')) {
            clearInterval(tryInject);
            return;
        }
        const advancedDiv = document.querySelector('#advanced_div');
        if (!advancedDiv) {
            if (attempts >= maxAttempts) clearInterval(tryInject);
            return;
        }
        const bindButton = document.createElement('div');
        bindButton.id = 'alt_binds_button';
        bindButton.className = 'menu_button fa-solid fa-link interactable';
        bindButton.title = 'Global Greeting Binds';
        bindButton.tabIndex = 0;
        bindButton.setAttribute('role', 'button');
        bindButton.addEventListener('click', () => {
            const context = SillyTavern.getContext();
            context.callPopup(createBindManagerPopup(), 'text', '', { wide: true, large: true });
        });
        const parent = advancedDiv.parentNode;
        parent.insertBefore(bindButton, parent.firstChild);
        clearInterval(tryInject);
    }, 500);
}

function injectContextButton() {
    let attempts = 0;
    const maxAttempts = 20;
    const tryInject = setInterval(() => {
        attempts++;
        if (document.getElementById('alt_context_button')) {
            clearInterval(tryInject);
            return;
        }
        const bindsButton = document.querySelector('#alt_binds_button');
        if (!bindsButton) {
            if (attempts >= maxAttempts) clearInterval(tryInject);
            return;
        }
        const contextButton = document.createElement('div');
        contextButton.id = 'alt_context_button';
        contextButton.className = 'menu_button fa-solid fa-note-sticky interactable';
        contextButton.title = 'Character Context Notes';
        contextButton.tabIndex = 0;
        contextButton.setAttribute('role', 'button');
        contextButton.addEventListener('click', () => {
            const context = SillyTavern.getContext();
            context.callPopup(createContextNotesPopup(), 'text', '', { wide: true, large: true });
        });
        const parent = bindsButton.parentNode;
        parent.insertBefore(contextButton, bindsButton.nextSibling);
        clearInterval(tryInject);
    }, 500);
}

function createContextNotesPopup() {
    const context = SillyTavern.getContext();
    const characterId = ContextUtil.getCharacterId();
    const character = context.characters[characterId];
    const characterName = ContextUtil.getName();
    if (!character) return document.createElement('div');

    const alternateGreetings = Array.isArray(character.data.alternate_greetings) ? character.data.alternate_greetings : [];
    const greetings = [character.data.first_mes || '', ...alternateGreetings];
    const contextNotesData = getContextNotesData(character);

    const container = document.createElement('div');
    container.className = 'flex-container flexFlowColumn alt-context-notes-popup';
    container.innerHTML = `
        <div class="flex-container justifySpaceBetween alignItemsCenter">
            <h3 class="margin0">Context Notes for <span>${escapeHtml(characterName)}</span></h3>
        </div>
        <hr>
        <div class="justifyLeft"><small>Add private notes per greeting. Notes autosave while you type.</small></div>
        <hr>
        <div id="context-notes-list" class="alt-context-notes-list flexFlowColumn flex-container wide100p"></div>`;

    const listContainer = container.querySelector('#context-notes-list');

    const saveNotes = () => {
        saveContextNotesData(characterId, character, contextNotesData);
        displayContextNotes();
    };

    const renderList = () => {
        listContainer.innerHTML = greetings.map((greeting, index) => {
            const textareaId = `context_note_${index}`;
            const noteText = contextNotesData[index] || '';
            const title = `Greeting #${index + 1}`;
            const snippet = greeting ? greeting.substring(0, 70) : '(empty greeting)';

            return `
                <div class="alternate_greeting context-note-item" data-note-index="${index}">
                    <details open>
                        <summary>
                            <div class="title_restorable gap5px">
                                <div class="flex-container alignItemsCenter context-note-title">
                                    <strong>${escapeHtml(title)}</strong>
                                    <span class="context-note-snippet">${escapeHtml(snippet)}${greeting.length > 70 ? '...' : ''}</span>
                                    <i class="editor_maximize fa-solid fa-maximize right_menu_button" title="Expand the editor" data-for="${textareaId}"></i>
                                </div>
                                <span class="expander"></span>
                                <div class="menu_button menu_button_icon move-up-context-note" data-index="${index}" title="Move note up">
                                    <i class="fa-solid fa-chevron-up"></i>
                                </div>
                                <div class="menu_button menu_button_icon move-down-context-note" data-index="${index}" title="Move note down">
                                    <i class="fa-solid fa-chevron-down"></i>
                                </div>
                                <div class="menu_button menu_button_icon clear-context-note" data-index="${index}">
                                    <i class="fa-solid fa-trash"></i><span>Clear</span>
                                </div>
                            </div>
                        </summary>
                        <textarea id="${textareaId}" class="text_pole textarea_compact context-note-text mdHotkeys" rows="8" data-index="${index}" placeholder="Add context notes for this greeting...">${escapeHtml(noteText)}</textarea>
                        <div class="extension_token_counter">
                            <span>Tokens:</span> <span data-context-token-display="${index}">calculating...</span>
                        </div>
                    </details>
                </div>`;
        }).join('');

        greetings.forEach(async (_, index) => {
            const tokenDisplay = container.querySelector(`[data-context-token-display="${index}"]`);
            if (tokenDisplay && context.getTokenCountAsync) {
                tokenDisplay.textContent = await context.getTokenCountAsync(contextNotesData[index] || '');
            }
        });

        listContainer.querySelectorAll('.context-note-text').forEach(textarea => {
            textarea.addEventListener('input', (event) => {
                const index = parseInt(event.target.dataset.index);
                contextNotesData[index] = event.target.value;

                const timeoutKey = `context-note:${index}`;
                if (contextNotesSaveTimeouts[timeoutKey]) clearTimeout(contextNotesSaveTimeouts[timeoutKey]);
                contextNotesSaveTimeouts[timeoutKey] = setTimeout(async () => {
                    if (!contextNotesData[index]?.trim()) delete contextNotesData[index];
                    saveNotes();

                    const tokenDisplay = container.querySelector(`[data-context-token-display="${index}"]`);
                    if (tokenDisplay && context.getTokenCountAsync) {
                        tokenDisplay.textContent = await context.getTokenCountAsync(contextNotesData[index] || '');
                    }
                }, 500);
            });
        });

        listContainer.querySelectorAll('.move-up-context-note, .move-down-context-note').forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const index = parseInt(event.currentTarget.dataset.index);
                const direction = event.currentTarget.classList.contains('move-up-context-note') ? -1 : 1;
                const newIndex = index + direction;
                if (newIndex < 0 || newIndex >= greetings.length) return;

                const currentNote = contextNotesData[index] || '';
                const targetNote = contextNotesData[newIndex] || '';
                if (targetNote) contextNotesData[index] = targetNote;
                else delete contextNotesData[index];
                if (currentNote) contextNotesData[newIndex] = currentNote;
                else delete contextNotesData[newIndex];

                saveNotes();
                renderList();
            });
        });

        listContainer.querySelectorAll('.clear-context-note').forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const index = parseInt(event.currentTarget.dataset.index);
                if (confirm(`Clear context notes for Greeting #${index + 1}?`)) {
                    delete contextNotesData[index];
                    saveNotes();
                    renderList();
                }
            });
        });
    };

    renderList();
    return container;
}

function displayContextNotes() {
    const context = SillyTavern.getContext();
    const characterId = ContextUtil.getCharacterId();
    const character = context.characters[characterId];
    const existing = document.querySelector('#context-notes-display');
    if (existing) existing.remove();
    if (!character) return;
    
    const firstMessage = document.querySelector('#chat .mes:first-child');
    if (!firstMessage) return;
    
    const currentGreetingIndex = (getCurrentGreetingNumber() || 1) - 1;
    const contextNotes = character.data.extensions?.context_notes_per_greeting?.[currentGreetingIndex] || '';
    if (!contextNotes.trim()) return;

    const substitutedNotes = contextNotes
        .replace(/\{\{char\}\}/gi, character.data?.name || 'Character')
        .replace(/\{\{user\}\}/gi, context.name1 || 'User');
    const formattedNotes = typeof context.messageFormatting === 'function'
        ? scopeFormattedContextStyles(context.messageFormatting(substitutedNotes, character.data?.name || 'Character', false, false, -1, {}, false))
        : escapeHtml(substitutedNotes).replace(/\n/g, '<br>');
    
    const contextDisplay = document.createElement('div');
    contextDisplay.id = 'context-notes-display';
    contextDisplay.innerHTML = `<div class="context-content">${formattedNotes}</div>`;
    firstMessage.parentNode.insertBefore(contextDisplay, firstMessage);
}

function createBindManagerPopup() {
    const container = document.createElement('div');
    container.className = 'flex-container flexFlowColumn';
    container.innerHTML = `<div class="flex-container justifySpaceBetween alignItemsCenter"><h3 class="margin0">Global Greeting Binds</h3></div><hr><div class="justifyLeft"><small>Link alternates to specific greetings.</small></div><div id="bind-manager-list" style="overflow-y: auto; max-height: 60vh; margin-top: 10px;"></div>`;
    const listContainer = container.querySelector('#bind-manager-list');
    const context = SillyTavern.getContext();
    const characterId = ContextUtil.getCharacterId();
    const character = context.characters[characterId];
    
    if (!character || !character.data.alternate_greetings) {
        listContainer.innerHTML = '<div style="text-align: center; padding: 20px;">No alternate greetings found.</div>';
        return container;
    }
    
    const greetings = [character.data.first_mes, ...character.data.alternate_greetings];
    let greetingBinds = character.data.extensions?.greeting_binds || {};
    
    greetings.forEach((greeting, greetingIndex) => {
        const greetingSection = document.createElement('div');
        greetingSection.style.cssText = 'margin-bottom: 20px; border: 1px solid rgba(128,128,128,0.3); border-radius: 4px; padding: 10px;';
        const header = document.createElement('div');
        header.style.cssText = 'cursor: pointer; font-weight: bold; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;';
        header.innerHTML = `<span><i class="fa-solid fa-chevron-down" style="margin-right: 8px;"></i>Greeting #${greetingIndex + 1}: ${greeting.substring(0, 60)}...</span>`;
        const content = document.createElement('div');
        content.style.display = 'none';
        content.style.marginTop = '10px';
        
        header.addEventListener('click', () => {
            const isExpanded = content.style.display !== 'none';
            content.style.display = isExpanded ? 'none' : 'block';
            header.querySelector('i').className = isExpanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
        });
        
        const currentBinds = greetingBinds[greetingIndex] || {};
        fieldConfigs.forEach(field => {
            const fieldData = ContextUtil.getFieldData(field);
            if (fieldData.length === 0) return;
            
            const row = document.createElement('div');
            row.style.cssText = 'margin-bottom: 10px; display: flex; align-items: center; gap: 10px;';
            row.innerHTML = `<label style="flex: 0 0 150px; font-weight: bold;">${field.button_name}:</label>`;
            const select = document.createElement('select');
            select.className = 'text_pole';
            select.style.flex = '1';
            select.innerHTML = '<option value="">-- None --</option>' + fieldData.map((e, i) => `<option value="${i}">${e.title}</option>`).join('');
            if (currentBinds[field.saveKey] !== undefined) select.value = currentBinds[field.saveKey];
            
            select.addEventListener('change', (e) => {
                if (!greetingBinds[greetingIndex]) greetingBinds[greetingIndex] = {};
                if (e.target.value === '') delete greetingBinds[greetingIndex][field.saveKey];
                else greetingBinds[greetingIndex][field.saveKey] = parseInt(e.target.value);
                if (!character.data.extensions) character.data.extensions = {};
                character.data.extensions.greeting_binds = greetingBinds;
                context.writeExtensionField(characterId, 'greeting_binds', greetingBinds);
            });
            row.appendChild(select);
            content.appendChild(row);
        });
        greetingSection.appendChild(header);
        greetingSection.appendChild(content);
        listContainer.appendChild(greetingSection);
    });
    return container;
}

function checkAutoLinksForGreeting(greetingNumber) {
    if (!greetingNumber) return;
    const context = SillyTavern.getContext();
    const characterId = ContextUtil.getCharacterId();
    const character = context.characters[characterId];
    if (!character || !character.data?.extensions?.greeting_binds) return;

    const greetingBinds = character.data.extensions.greeting_binds;
    const greetingIndex = parseInt(greetingNumber) - 1;
    const bindings = greetingBinds[greetingIndex];
    if (!bindings) return;

    fieldConfigs.forEach(field => {
        if (bindings[field.saveKey] === undefined) return;

        const fieldData = ContextUtil.getFieldData(field);
        const boundIndex = bindings[field.saveKey];
        if (!fieldData[boundIndex]) return;

        if (isManualFieldEditActive(field)) {
            return;
        }

        console.log(`[AltFields] Auto-swapping ${field.field} to "${fieldData[boundIndex].title}"`);
        ContextUtil.setCurrentField(field, fieldData[boundIndex].content, true);
    });
}

function checkAutoLinks(greetingNumber) {
    return checkAutoLinksForGreeting(greetingNumber);
}

function registerAutoLinkEventHooks() {
    if (autoLinkEventHooksRegistered) return;

    const context = SillyTavern.getContext();
    const eventSource = context.eventSource;
    const eventTypes = context.eventTypes || context.event_types;
    if (!eventSource || !eventTypes) return;

    autoLinkEventHooksRegistered = true;

    const reapplyCurrentGreeting = () => {
        [0, 100, 500].forEach(delay => scheduleAutoLinkCheck(delay));
    };

    if (eventTypes.MESSAGE_SWIPED) eventSource.on(eventTypes.MESSAGE_SWIPED, mesId => {
        if (Number(mesId) === 0) reapplyCurrentGreeting();
    });
    if (eventTypes.CHAT_CHANGED) eventSource.on(eventTypes.CHAT_CHANGED, reapplyCurrentGreeting);
    if (eventTypes.CHARACTER_EDITED) eventSource.on(eventTypes.CHARACTER_EDITED, reapplyCurrentGreeting);
    if (eventTypes.CHARACTER_MESSAGE_RENDERED) eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, mesId => {
        if (Number(mesId) === 0) reapplyCurrentGreeting();
    });

    const beforeGeneration = () => {
        const greetingNumber = getCurrentGreetingNumber();
        if (greetingNumber) checkAutoLinks(greetingNumber);
    };

    if (!eventTypes.GENERATION_AFTER_COMMANDS) return;

    if (typeof eventSource.makeFirst === 'function') {
        eventSource.makeFirst(eventTypes.GENERATION_AFTER_COMMANDS, beforeGeneration);
    } else {
        eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, beforeGeneration);
    }
}

function monitorGreetingChanges() {
    console.log('[AltFields] Greeting monitor initialized');
    let lastGreetingNum = null;
    let debounceTimer = null;
    
    const checkCurrentGreeting = () => {
        const context = SillyTavern.getContext();
        if (context.generating) return;

        const firstMessage = document.querySelector('#chat .mes:first-child');
        if (!firstMessage) return;
        const counter = firstMessage.querySelector('.swipes-counter');
        if (!counter) return;
        const match = counter.textContent.replace(/\u200B/g, '').trim().match(/^(\d+)/);
        
        if (match) {
            const currentGreeting = match[1];

            // Initialize on first load so we don't trigger immediately
            if (lastGreetingNum === null) {
                lastGreetingNum = currentGreeting;
                return;
            }

            // If we detect a change in the Greeting Number...
            if (currentGreeting !== lastGreetingNum) {
                console.log(`[AltFields] Change detected: ${lastGreetingNum} -> ${currentGreeting}. Waiting for save...`);

                // 1. Update our tracker immediately so we don't spam logs
                lastGreetingNum = currentGreeting;

                // 2. Clear any existing timer (if the user is swiping frantically)
                if (debounceTimer) clearTimeout(debounceTimer);

                // 3. START THE TIMER (2000ms / 2 Seconds)
                // This is the "Save Buffer". We do NOTHING for 2 seconds.
                // This gives SillyTavern time to save the fact that you swiped to Intro #2.
                debounceTimer = setTimeout(() => {
                    
                    // 4. VERIFY: Are we still on the same greeting we detected 2 seconds ago?
                    // If the user swiped away again, or ST reverted on its own, abort.
                    const freshMessage = document.querySelector('#chat .mes:first-child');
                    const freshCounter = freshMessage?.querySelector('.swipes-counter');
                    const freshMatch = freshCounter?.textContent.replace(/\u200B/g, '').trim().match(/^(\d+)/);
                    
                    if (freshMatch && freshMatch[1] === currentGreeting) {
                         // Double check we aren't generating
                        if (!SillyTavern.getContext().generating) {
                            console.log(`[AltFields] Save buffer passed. Executing swap for Greeting ${currentGreeting}`);
                            try { checkAutoLinks(currentGreeting); } catch (e) { console.error(e); }
                            if (typeof displayContextNotes === 'function') displayContextNotes();
                        }
                    }
                }, 2000); // 2000ms delay
            }
        }
    };
    setInterval(checkCurrentGreeting, 500);
    const observer = new MutationObserver(() => setTimeout(checkCurrentGreeting, 50));
    const bodyObserver = new MutationObserver(() => {
        const chatContainer = document.querySelector('#chat');
        if (chatContainer) {
            observer.disconnect();
            observer.observe(chatContainer, { childList: true, subtree: true, characterData: true });
        }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
}

function registerSlashCommand() {
    const fieldEnumProvider = () => fieldConfigs.map(field => new SlashCommandEnumValue(field.field, field.button_name, enumTypes.name));
    const fieldNameEnumProvider = (executor) => {
        const fieldValue = executor.namedArgumentList.find(x => x.name === 'field')?.value;
        if (!fieldValue) return [];
        const fieldConfig = fieldConfigs.find(f => f.field === fieldValue);
        if (!fieldConfig) return [];
        const fieldData = ContextUtil.getFieldData(fieldConfig);
        return fieldData.map(entry => new SlashCommandEnumValue(entry.title, entry.content.substring(0, 50) + (entry.content.length > 50 ? '...' : ''), enumTypes.name));
    };

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'altfield',
        callback: altFieldCallback,
        helpString: `<div>Switch to an alternate field entry. Must have a character selected.</div>`,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'field', description: 'Field type', typeList: [ARGUMENT_TYPE.STRING], isRequired: true, enumProvider: fieldEnumProvider, forceEnum: true }),
            SlashCommandNamedArgument.fromProps({ name: 'name', description: 'Name of the alternate', typeList: [ARGUMENT_TYPE.STRING], enumProvider: fieldNameEnumProvider })
        ],
        returns: ARGUMENT_TYPE.STRING
    }));
}

function altFieldCallback(namedArguments) {
    const { field, name } = namedArguments;
    try {
        const fieldConfig = fieldConfigs.find(f => f.field === field);
        if (!fieldConfig) return `Error: Unknown field "${field}"`;
        const fieldData = ContextUtil.getFieldData(fieldConfig);
        if (fieldData.length === 0) return `Error: No entries found for ${field}`;
        let alternate;
        if (name && name.trim()) {
            alternate = fieldData.find(entry => entry.title === name);
            if (!alternate) return `Error: No alternate named "${name}" found`;
        } else {
            alternate = fieldData[Math.floor(Math.random() * fieldData.length)];
        }
        ContextUtil.setCurrentField(fieldConfig, alternate.content);
        return alternate.content;
    } catch (error) {
        console.error('Error in altfield command:', error);
        return `Error: ${error.message}`;
    }
}

injectButtons();
registerManualFieldEditTracking();
registerSlashCommand();
registerAutoLinkEventHooks();
monitorGreetingChanges();
