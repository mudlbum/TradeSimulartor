/**
 * @fileoverview Manages data persistence using the Origin Private File System (OPFS)
 * for performance history and localStorage for settings and API keys. Also handles
 * import, export, and clearing of application data.
 */

import { state, setState } from './state.js';
import { UI } from './config.js';
import { logMessage, showToast, updateDashboardUI, updatePerformanceChart } from './ui.js';

/**
 * Gets a handle to the data file in the Origin Private File System.
 * @param {boolean} create - If true, creates the file if it doesn't exist.
 * @returns {Promise<FileSystemFileHandle|null>} A file handle or null if access fails.
 */
async function getOpfsFileHandle(create = false) {
    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('trading_bot_data.json', { create });
        return fileHandle;
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return null; // File simply doesn't exist.
        }
        logMessage(`Could not access secure file storage: ${error.message}`, "error");
        return null;
    }
}

/**
 * Loads performance data and settings from the OPFS file into the application state.
 */
export async function loadDataFromFile() {
    const fileHandle = await getOpfsFileHandle();
    if (!fileHandle) {
        logMessage("No local data file found. A new one will be created on save.", "action");
        return;
    }

    try {
        const file = await fileHandle.getFile();
        const contents = await file.text();

        if (contents) {
            const data = JSON.parse(contents);
            const newState = {};

            // We apply settings from the file first, as localStorage settings (loaded next) are more current.
            if (data.settings) {
                newState.settings = { ...state.settings, ...data.settings };
            }

            if (data.performanceData && data.initialEquity) {
                newState.performanceData = data.performanceData.map(d => ({ ...d, x: new Date(d.x) }));
                newState.portfolio = { ...state.portfolio, initial_equity: data.initialEquity };

                if (newState.performanceData.length > 0) {
                    const lastEntry = newState.performanceData[newState.performanceData.length - 1];
                    newState.portfolio.equity = lastEntry.y;
                    newState.portfolio.last_equity = lastEntry.y; // Assume last saved equity is the previous day's close
                }
            }

            newState.isFirstTradeMadeToday = data.isFirstTradeMadeToday || false;
            newState.lastTradeDate = data.lastTradeDate || null;

            setState(newState); // Update the global state

            updatePerformanceChart();
            updateDashboardUI();
            logMessage(`Data loaded from secure storage.`, "action");
        }
    } catch (error) {
        logMessage(`Failed to read from data file: ${error.message}`, "error");
    }
}

/**
 * Saves the current application state to the OPFS file and settings to localStorage.
 * @param {boolean} force - If true, saves even if the bot isn't running.
 */
export async function saveDataAndSettings(force = false) {
    if (!state.isBotRunning && !force) return;

    const fileHandle = await getOpfsFileHandle(true); // create = true
    if (!fileHandle) {
        logMessage("Automatic save failed: Could not get file handle.", "error");
        return;
    }

    try {
        const dataToSave = {
            performanceData: state.performanceData,
            initialEquity: state.portfolio.initial_equity,
            settings: state.settings,
            isFirstTradeMadeToday: state.isFirstTradeMadeToday,
            lastTradeDate: state.lastTradeDate,
            lastUpdated: new Date().toISOString()
        };
        const dataStr = JSON.stringify(dataToSave, null, 2);

        const writable = await fileHandle.createWritable();
        await writable.write(dataStr);
        await writable.close();

        // Also save current settings to localStorage for quick access
        localStorage.setItem(`tradingBotSettings_${state.userId}`, JSON.stringify({ apiKeys: state.apiKeys, settings: state.settings }));

        if (force) {
            logMessage("Data and settings saved to secure storage.", "action");
            showToast("Settings saved successfully.", "success");
        }

    } catch (error) {
        logMessage(`Automatic save failed: ${error.message}`, "error");
    }
}

/**
 * Saves settings from the UI to localStorage and triggers a full data save.
 */
export async function saveSettingsFromUI() {
    const settingsData = {
        apiKeys: {
            alpacaKey: UI.settings.alpacaKey.value.trim(),
            alpacaSecret: UI.settings.alpacaSecret.value.trim(),
            geminiKey: UI.settings.geminiKey.value.trim(),
        },
        settings: {
            riskPerTrade: parseFloat(UI.settings.riskPerTrade.value),
            maxConcurrentScalps: parseInt(UI.settings.maxConcurrentScalps.value, 10),
            limitOrderOffset: parseFloat(UI.settings.limitOrderOffset.value),
            aiAnalysisFreq: parseInt(UI.settings.aiAnalysisFreq.value, 10)
        }
    };
    localStorage.setItem(`tradingBotSettings_${state.userId}`, JSON.stringify(settingsData));
    applySettings(settingsData);
    await saveDataAndSettings(true); // Force save to persist settings in OPFS as well
}

/**
 * Loads API keys and trading parameters from localStorage.
 */
export function loadSettingsFromStorage() {
    const localSettings = localStorage.getItem(`tradingBotSettings_${state.userId}`);
    if (localSettings) {
        applySettings(JSON.parse(localSettings));
    }
}

/**
 * Applies loaded settings to the application state and updates the UI form fields.
 * @param {object} data - The settings data object.
 */
function applySettings(data) {
    if (!data) return;
    const newState = {};
    if (data.apiKeys) {
        newState.apiKeys = { ...state.apiKeys, ...data.apiKeys };
    }
    if (data.settings) {
        newState.settings = { ...state.settings, ...data.settings };
    }
    setState(newState);

    // Update UI fields
    UI.settings.alpacaKey.value = state.apiKeys.alpacaKey || '';
    UI.settings.alpacaSecret.value = state.apiKeys.alpacaSecret || '';
    UI.settings.geminiKey.value = state.apiKeys.geminiKey || '';
    UI.settings.riskPerTrade.value = state.settings.riskPerTrade;
    UI.settings.maxConcurrentScalps.value = state.settings.maxConcurrentScalps;
    UI.settings.limitOrderOffset.value = state.settings.limitOrderOffset;
    UI.settings.aiAnalysisFreq.value = state.settings.aiAnalysisFreq;
}

/**
 * Exports the OPFS data file for download.
 */
export async function exportData() {
    logMessage("Exporting application data...", "action");
    try {
        const handle = await getOpfsFileHandle();
        if (!handle) {
            showToast("No data file found to export.", "warning");
            return;
        }
        const file = await handle.getFile();
        const contents = await file.text();
        const blob = new Blob([contents], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trading_bot_data_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Data exported successfully.", "success");
    } catch (e) {
        logMessage(`Export failed: ${e.message}`, "error");
        showToast("Data export failed.", "error");
    }
}

/**
 * Imports a data file selected by the user into the OPFS.
 * @param {Event} event - The file input change event.
 */
export function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const content = e.target.result;
            JSON.parse(content); // Validate JSON format before writing
            const handle = await getOpfsFileHandle(true);
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            showToast("Import successful! Reloading application...", "success");
            logMessage("Data imported successfully. Please reload.", "action");
            setTimeout(() => window.location.reload(), 2000);
        } catch (err) {
            logMessage(`Import failed: ${err.message}`, "error");
            showToast("Import failed. Invalid file format.", "error");
        }
    };
    reader.readAsText(file);
    UI.data.importInput.value = ''; // Reset input to allow re-importing the same file
}

/**
 * Clears all application data from OPFS.
 */
export async function clearData() {
    // A simple browser confirm is acceptable here as it's a destructive, user-initiated action.
    if (!window.confirm("Are you sure you want to delete all trading data? This action cannot be undone.")) {
        return;
    }
    logMessage("Clearing all application data...", "action");
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry('trading_bot_data.json');
        showToast("Data cleared. Reloading application...", "success");
        setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
        if (e.name === 'NotFoundError') {
            showToast("No data file to clear.", "info");
        } else {
            logMessage(`Failed to clear data: ${e.message}`, "error");
            showToast("Failed to clear data.", "error");
        }
    }
}
