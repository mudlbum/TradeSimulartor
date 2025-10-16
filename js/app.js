/**
 * @fileoverview Main application entry point.
 * This file orchestrates the entire trading bot, connecting the UI,
 * API services, data management, and trading strategies.
 */

// --- MODULE IMPORTS ---
import { UI } from './config.js';
import { state, setState } from './state.js';
import { AuthError, closePositionFromApi, updatePortfolioAndPositions } from './api.js';
import { logMessage, showToast, updateDashboardUI, initializeChart, updateStatus, setLoadingText } from './ui.js';
import { loadDataFromFile, saveDataAndSettings, saveSettingsFromUI, loadSettingsFromStorage, exportData, importData, clearData } from './data.js';
import { isMarketOpen } from './utils.js';
import { runAiDrivenAnalysis, runScalpingStrategy } from './strategy.js';


// --- GLOBAL VARIABLES ---
let tradeCycleInterval = null;
let aiAnalysisInterval = null;

// --- CORE APPLICATION LOGIC ---

/**
 * Starts the trading bot and its cycles.
 */
function startBot() {
    if (!state.apiKeys.alpacaKey || !state.apiKeys.alpacaSecret || !state.apiKeys.geminiKey) {
        showToast("Alpaca and Gemini API keys are required in Settings.", "error");
        return;
    }
    setState({ isBotRunning: true });
    updateStatus('Active', 'bg-green-500');
    logMessage('Bot started. Initializing cycles.', 'signal');

    // Run cycles immediately on start, then set intervals
    tradeCycle();
    runAiDrivenAnalysis();

    tradeCycleInterval = setInterval(tradeCycle, 30 * 1000); // 30 seconds
    const aiIntervalMs = (state.settings.aiAnalysisFreq || 30) * 60 * 1000;
    aiAnalysisInterval = setInterval(runAiDrivenAnalysis, aiIntervalMs);
}

/**
 * Stops the trading bot and clears intervals.
 */
async function stopBot() {
    setState({ isBotRunning: false });
    clearInterval(tradeCycleInterval);
    clearInterval(aiAnalysisInterval);
    await saveDataAndSettings(true); // Perform a final save
    updateStatus('Idle', 'bg-red-500');
    logMessage('Bot stopped by user.', 'action');
}

/**
 * The main loop that runs every 30 seconds to manage trading activities.
 */
async function tradeCycle() {
    if (!state.isBotRunning) return;

    try {
        const today = new Date().toLocaleDateString();
        if (state.lastTradeDate !== today) {
            logMessage(`New trading day detected. Resetting daily flags.`, 'signal');
            setState({ isFirstTradeMadeToday: false, lastTradeDate: today });
        }

        logMessage("Starting trade cycle...", "action");
        await updatePortfolioAndPositions();

        if (isMarketOpen()) {
            await runScalpingStrategy();
        } else {
            logMessage("Market is closed. Skipping scalping.", "action");
        }

        await saveDataAndSettings();
        logMessage("Trade cycle finished.", "action");

    } catch (error) {
        logMessage(`Trade cycle error: ${error.message}`, 'error');
        if (error instanceof AuthError) {
           await stopBot(); // Stop the bot on authentication failure
        }
    }
}

/**
 * Manages the process of closing a position manually from the UI.
 * @param {string} symbol - The stock symbol to close.
 */
async function closePosition(symbol) {
    logMessage(`User initiated close for ${symbol}...`, 'action');
    try {
        await closePositionFromApi(symbol);
        showToast(`Closing position in ${symbol}.`, 'success');
    } catch (e) {
        logMessage(`Failed to close position for ${symbol}: ${e.message}`, 'error');
        showToast(`Failed to close ${symbol}.`, 'error');
    } finally {
        // Wait a moment for the order to process before updating the UI
        await new Promise(res => setTimeout(res, 2000));
        await updatePortfolioAndPositions();
    }
}

// --- INITIALIZATION ---

/**
 * Sets up all the event listeners for the UI.
 */
function setupEventListeners() {
    // Save data on page unload if bot is running
    window.addEventListener('pagehide', () => {
        if (state.isBotRunning) {
            saveDataAndSettings(true);
        }
    });

    // Main controls
    UI.startStopBtn.addEventListener('click', () => (state.isBotRunning ? stopBot() : startBot()));
    UI.settings.saveBtn.addEventListener('click', saveSettingsFromUI);

    // Tab navigation
    UI.tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            UI.tabs.forEach(t => t.classList.replace('tab-active', 'tab-inactive'));
            tab.classList.replace('tab-inactive', 'tab-active');
            UI.tabContents.forEach(content => content.classList.add('hidden'));
            const contentId = tab.getAttribute('href').substring(1) + '-content';
            document.getElementById(contentId).classList.remove('hidden');
        });
    });

    // Close position button in the positions table
    UI.positionsTableBody.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if (button && button.dataset.action === 'close') {
            const symbol = button.dataset.symbol;
            if (symbol) {
                button.disabled = true;
                button.textContent = 'Closing...';
                await closePosition(symbol);
            }
        }
    });

    // Data management buttons
    UI.data.exportBtn.addEventListener('click', exportData);
    UI.data.importBtn.addEventListener('click', () => UI.data.importInput.click());
    UI.data.importInput.addEventListener('change', importData);
    UI.data.clearBtn.addEventListener('click', clearData);
}

/**
 * The main initialization function for the application.
 */
async function initializeApp() {
    setLoadingText("Initializing Application...");

    // Set a unique user ID for storing settings if one doesn't exist
    let userId = localStorage.getItem('tradingBotUserId_enhanced');
    if (!userId) {
        userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('tradingBotUserId_enhanced', userId);
    }
    setState({ userId });

    setLoadingText("Loading settings and data...");
    loadSettingsFromStorage();
    await loadDataFromFile(); // Load performance history and other data from OPFS

    setupEventListeners();
    initializeChart();

    logMessage("App initialized. Configure settings and press Start.", "action");
    UI.loadingOverlay.style.display = 'none';
}

// --- APP START ---
window.onload = initializeApp;

