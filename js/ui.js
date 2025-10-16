/**
 * @fileoverview Manages all Document Object Model (DOM) interactions and UI updates.
 * This includes rendering data, showing notifications, and handling the performance chart.
 * Keeping all UI logic here makes the main application logic cleaner and easier to understand.
 */

import { UI } from './config.js';
import { state } from './state.js';

let performanceChart; // This module will own the chart instance.

/**
 * Initializes the Chart.js performance chart.
 */
export function initializeChart() {
    const ctx = UI.performanceChartCanvas.getContext('2d');
    performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Portfolio Value',
                data: [], // Initially empty, will be populated by updatePerformanceChart
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: {
                        color: '#94a3b8',
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Updates the performance chart with the latest data.
 */
export function updatePerformanceChart() {
    if (!performanceChart) return;
    performanceChart.data.datasets[0].data = state.performanceData;
    performanceChart.update();
}

/**
 * Updates the main dashboard widgets (Portfolio Value, P/L).
 */
export function updateDashboardUI() {
    UI.portfolioValue.textContent = `$${state.portfolio.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const todayPL = state.portfolio.equity - state.portfolio.last_equity;
    UI.todayPL.textContent = `$${todayPL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    UI.todayPL.className = `text-3xl font-bold mt-1 ${todayPL >= 0 ? 'text-green-400' : 'text-red-400'}`;

    const totalPL = state.portfolio.initial_equity > 0 ? state.portfolio.equity - state.portfolio.initial_equity : 0.00;
    UI.totalPL.textContent = `$${totalPL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    UI.totalPL.className = `text-3xl font-bold mt-1 ${totalPL >= 0 ? 'text-green-400' : 'text-red-400'}`;
}

/**
 * Renders the list of open positions in its table.
 */
export function renderPositionsTable() {
    if (state.positions.length === 0) {
        UI.positionsTableBody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">No open positions.</td></tr>';
        return;
    }
    UI.positionsTableBody.innerHTML = state.positions.map(pos => {
        const pl = parseFloat(pos.unrealized_pl);
        const plColor = pl >= 0 ? 'text-green-400' : 'text-red-400';
        const stopPriceText = pos.stop_price ? `$${parseFloat(pos.stop_price).toFixed(2)}` : 'N/A';

        return `
            <tr class="border-b border-gray-700 hover:bg-slate-800">
                <td class="px-6 py-4 font-medium text-white">${pos.symbol}</td>
                <td class="px-6 py-4 text-right">${pos.qty}</td>
                <td class="px-6 py-4 text-right">$${parseFloat(pos.avg_entry_price).toFixed(2)}</td>
                <td class="px-6 py-4 text-right">$${parseFloat(pos.current_price).toFixed(2)}</td>
                <td class="px-6 py-4 text-right ${plColor}">$${pl.toFixed(2)} (${(parseFloat(pos.unrealized_plpc) * 100).toFixed(2)}%)</td>
                <td class="px-6 py-4 text-right text-orange-400">${stopPriceText}</td>
                <td class="px-6 py-4 text-right"><button data-action="close" data-symbol="${pos.symbol}" class="text-red-500 hover:underline disabled:text-gray-500">Close</button></td>
            </tr>
        `;
    }).join('');
}

/**
 * Renders the AI Watchlist based on the latest analysis.
 */
export function renderAiWatchlist() {
    const container = UI.aiWatchlistContainer;
    if (state.aiWatchlist.length === 0) {
        container.innerHTML = `<p class="text-gray-500 italic md:col-span-2 lg:col-span-3 xl:col-span-4">No high-confidence BUY signals from AI analysis.</p>`;
        return;
    }

    container.innerHTML = state.aiWatchlist.map(stock => `
        <div class="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
            <div class="flex justify-between items-center">
                <h4 class="text-lg font-bold text-white">${stock.ticker}</h4>
                <span class="text-xs font-semibold px-2 py-1 rounded-full ${stock.confidence >= 8 ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'}">
                    Confidence: ${stock.confidence}/10
                </span>
            </div>
            <p class="text-xs text-gray-400 mt-2 h-10 overflow-hidden">${stock.reasoning}</p>
            <div class="mt-3 pt-3 border-t border-slate-700 grid grid-cols-2 gap-2 text-xs">
                <div title="5-minute Relative Strength Index"><span class="text-gray-500">RSI(5m):</span> <span class="font-mono text-gray-200">${stock.rsi5m.toFixed(1)}</span></div>
                <div title="1-minute Relative Strength Index"><span class="text-gray-500">RSI(1m):</span> <span class="font-mono text-gray-200">${stock.rsi1m.toFixed(1)}</span></div>
                <div title="Average True Range (Volatility)"><span class="text-gray-500">ATR:</span> <span class="font-mono text-gray-200">${stock.atr.toFixed(3)}</span></div>
                <div title="MACD Crossover Signal"><span class="text-gray-500">MACD:</span> <span class="font-mono ${stock.macd.histogram > 0 ? 'text-green-400' : 'text-red-400'}">${stock.macd.histogram > 0 ? 'Bullish' : 'Bearish'}</span></div>
            </div>
        </div>
    `).join('');
}


/**
 * Adds a message to the event log.
 * @param {string} message The message to log.
 * @param {string} type The type of message (e.g., 'buy', 'sell', 'error').
 */
export function logMessage(message, type) {
    const colors = {
        buy: 'text-blue-400',
        sell: 'text-red-400',
        signal: 'text-yellow-400',
        action: 'text-gray-400',
        error: 'text-red-500 font-bold'
    };
    const logEntry = document.createElement('div');
    logEntry.className = `text-sm ${colors[type] || 'text-gray-500'}`;
    logEntry.innerHTML = `<span class="font-mono text-xs">${new Date().toLocaleTimeString()}</span> &raquo; ${message}`;

    // Clear initial "Bot is idle" message if it exists
    const firstChild = UI.eventLog.firstChild;
    if (firstChild && firstChild.nodeName === 'P') {
        UI.eventLog.innerHTML = '';
    }

    UI.eventLog.prepend(logEntry);
}

/**
 * Updates the bot's status indicator.
 * @param {string} text The status text (e.g., 'Active', 'Idle').
 * @param {string} color The TailwindCSS background color class for the status dot.
 */
export function updateStatus(text, color) {
    UI.statusText.textContent = text;
    UI.statusDot.className = `h-3 w-3 rounded-full ${color} mr-2`;
}

/**
 * Sets the text on the loading overlay.
 * @param {string} text The text to display.
 */
export function setLoadingText(text) {
    UI.loadingText.textContent = text;
}

/**
 * Displays a short-lived notification toast.
 * @param {string} message The message to show.
 * @param {string} type The type of toast ('info', 'success', 'error', 'warning').
 */
export function showToast(message, type = "info") {
    const colors = {
        info: "bg-blue-500",
        success: "bg-green-500",
        error: "bg-red-500",
        warning: "bg-yellow-500"
    };
    const toast = document.createElement("div");
    toast.className = `px-4 py-3 rounded-lg shadow-lg text-white text-sm ${colors[type]} animate-pulse`;
    toast.textContent = message;
    UI.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = "opacity 0.5s ease";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

/**
 * Sets up the tab navigation functionality.
 */
export function setupTabNavigation() {
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
}
