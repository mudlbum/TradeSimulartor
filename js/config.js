/**
 * @fileoverview This file centralizes the configuration for the application.
 * It includes references to all UI elements and the initial state of the bot.
 * This makes it easier to manage and update the application's core settings.
 */

// UI element mapping. This object provides easy access to all DOM elements used by the app.
export const UI = {
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    startStopBtn: document.getElementById('start-stop-btn'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    portfolioValue: document.getElementById('portfolio-value'),
    todayPL: document.getElementById('today-pl'),
    totalPL: document.getElementById('total-pl'),
    eventLog: document.getElementById('event-log'),
    positionsTableBody: document.getElementById('positions-table-body'),
    performanceChartCanvas: document.getElementById('performance-chart'),
    toastContainer: document.getElementById('toast-container'),
    tabs: document.getElementById('tabs').querySelectorAll('a'),
    tabContents: document.getElementById('tab-content').querySelectorAll('div[id$="-content"]'),
    aiWatchlistContainer: document.getElementById('ai-watchlist-container'),
    settings: {
        alpacaKey: document.getElementById('alpaca-key'),
        alpacaSecret: document.getElementById('alpaca-secret'),
        geminiKey: document.getElementById('gemini-key'),
        riskPerTrade: document.getElementById('risk-per-trade'),
        maxConcurrentScalps: document.getElementById('max-concurrent-scalps'),
        limitOrderOffset: document.getElementById('limit-order-offset'),
        aiAnalysisFreq: document.getElementById('ai-analysis-freq'),
        saveBtn: document.getElementById('save-settings-btn'),
    },
    data: {
        exportBtn: document.getElementById('export-data-btn'),
        importBtn: document.getElementById('import-data-btn'),
        importInput: document.getElementById('import-data-input'),
        clearBtn: document.getElementById('clear-data-btn'),
    }
};

// Initial state for the application. This object holds all the dynamic data.
export const initialState = {
    isBotRunning: false,
    userId: null,
    apiKeys: { alpacaKey: '', alpacaSecret: '', geminiKey: '' },
    settings: { riskPerTrade: 1, maxConcurrentScalps: 5, limitOrderOffset: 0.05, aiAnalysisFreq: 30 },
    portfolio: { equity: 0, last_equity: 0, initial_equity: 0 },
    positions: [],
    tradeCycleInterval: null,
    aiAnalysisInterval: null,
    performanceData: [],
    aiWatchlist: [],
    lastTradeDate: null,
    isFirstTradeMadeToday: false,
};
