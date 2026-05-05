# SillyTavern Alternate Fields
*Formerly "Alternate Descriptions" - Forked and Updated by Dayros*

## Overview

A SillyTavern extension that allows you to save and manage multiple versions of character fields within a single character card. Perfect for experimenting with different character concepts without losing your original work. 

**Supported Fields**: Description, Personality, Scenario, Example Dialogue, Main Prompt, Post-History Instructions

## ✨ New Features in this Version

- **🔗 Global Greeting Binds:** Link specific alternate fields to specific greetings. Automatically swap out the Description, Scenario, etc., when you swipe to a new intro! Perfect for progressing storylines (e.g., Intro 1: Enemies, Intro 2: Lovers) or Multi-Char cards.
- **📝 Context Notes:** Private, user-only notes attached to each greeting. Invisible to the AI, this helps give the user context about the current scenario. Supports HTML and CSS formatting!
- **📦 Clean Export:**Export your character with all alternate data in a clean, structured JSON format.
- **Reordering & QoL UI:** Easily move alternate fields up and down your list, and collapse/expand editors for a cleaner UI.

## Core Features

- **Multi-field support** – Supports unlimited alternate versions for each of the 6 default character fields.
- **Intro linking** – Optionally link fields to specific intros, so each intro can use different Description, Personality, Scenario, Example Dialogue, Main Prompt, and Post-History Instructions.
- **Auto-save** - Automatically saves current field content on first use.
- **Visual indicators** - Shows which alternate is currently active & warns before switching with unsaved changes.
- **Token counting** - Shows token count for each alternate.
- **Slash command support** - Switch alternates via `/altfield` command.
- **Portable** - Data stored in the character card, stays with the character.

## Installation

1. Open SillyTavern
2. Go to **Extensions** → **Install extension**  
3. Enter the repository URL: `https://github.com/DAYROS-V2/SillyTavern-AlternateFields`
4. Click **Download**
The extension adds “Alt. [Field]” buttons above supported fields, along with new menu icons in the selected character menu.

## Usage

### Basic Usage
1. **Open the manager**: Click the "Alt. [Field]" button above any supported field in the character editor.
2. **Add new alternates**: Click the "Add New" button to create a new alternate (duplicates current content).
3. **Switch alternates**: Click the "Use" button to switch to a different alternate.
4. **Edit alternates**: Modify titles and content directly in the popup.
5. **Reorder**: Use the Up/Down arrows to organize your alternates.

### 🔗 Greeting Binds (Progressive Storylines)
1. Open the Character menu (where you'd normally find global settings).
2. Click the **Chain Icon** (`fa-link`) to open the Global Greeting Binds menu.
3. Assign your saved alternate fields to specific Alternate Greetings. 
4. Now, when you swipe to a new intro message in chat, the character's fields will automatically swap to match the intro!

### 📝 Context Notes
1. Click the **Note Icon** (`fa-note-sticky`) next to the binds button.
2. Write private notes for the {{user}} for each greeting. 
3. When that greeting is active, the notes will appear above the chat for *you* to read, but the AI will never see them. Great for setting the scene for {{user}} with out wasting tokens!

### Slash Command Usage

The `/altfield` command allows quick switching between alternates:

```text
/altfield field=<field_name> name=<alternate_name>
