/**
 * @fileoverview Handles all API communications for the trading bot.
 * This includes fetching data from Alpaca, sending orders, and getting AI analysis from Gemini.
 * It also includes robust error handling and rate-limit backoff logic.
 */

import { state, setState } from './state.js';
import { logMessage, renderPositionsTable, updateDashboardUI, updatePerformanceChart, showToast } from './ui.js';
import { calculateRSI, calculateATR, calculateMACD } from './utils.js';

// Custom Error for Authentication issues to be caught by the main app logic.
export class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}

/**
 * A wrapper for the fetch API that includes exponential backoff for retries.
 * This helps in gracefully handling rate limits (429) and transient network errors.
 * @param {string} url The URL to fetch.
 * @param {object} options The fetch options (method, headers, body).
 * @param {number} retries Number of retries left.
 * @param {number} delay The delay in ms before the next retry.
 * @returns {Promise<object|boolean>} The JSON response or true for 204 No Content.
 * @throws {AuthError} on 401 Unauthorized status.
 * @throws {Error} on other failed responses after all retries are exhausted.
 */
async function fetchWithBackoff(url, options, retries = 3, delay = 2000) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            if (response.status === 401) {
                // Specific error for authentication failure.
                throw new AuthError('Authentication Failed (401). Please check your API keys.');
            }
            if (response.status === 429 && retries > 0) {
                logMessage(`Rate limit hit. Retrying in ${delay / 1000}s...`, 'error');
                await new Promise(res => setTimeout(res, delay));
                return fetchWithBackoff(url, options, retries - 1, delay * 2); // Exponential backoff
            }
            const errorText = await response.text();
            throw new Error(`API Error (${response.status}): ${errorText}`);
        }
        // For DELETE requests that return no content.
        if (response.status === 204) return true;

        return await response.json();
    } catch (error) {
        // Rethrow AuthError immediately.
        if (error instanceof AuthError) {
            throw error;
        }
        // Retry for other network errors.
        if (retries > 0) {
            await new Promise(res => setTimeout(res, delay));
            return fetchWithBackoff(url, options, retries - 1, delay * 2);
        }
        // If all retries fail, throw the last error.
        throw error;
    }
}

/**
 * A specialized fetch function for the Alpaca API.
 * It determines the correct base URL (paper trading vs. market data) and sets auth headers.
 * @param {string} endpoint The API endpoint to call (e.g., '/v2/account').
 * @param {object} options The fetch options.
 * @returns {Promise<any>} The response from the Alpaca API.
 */
export async function alpacaFetch(endpoint, options = {}) {
    let url;
    // Differentiate between data endpoints and trading endpoints.
    if (endpoint.startsWith('/v1beta1/') || endpoint.startsWith('/v2/stocks')) {
        url = `https://data.alpaca.markets${endpoint}`;
    } else {
        url = `https://paper-api.alpaca.markets${endpoint}`;
    }

    const headers = {
        'APCA-API-KEY-ID': state.apiKeys.alpacaKey,
        'APCA-API-SECRET-KEY': state.apiKeys.alpacaSecret,
    };

    if (options.body) {
        headers['Content-Type'] = 'application/json';
    }

    return fetchWithBackoff(url, { ...options, headers });
}

/**
 * Fetches market data and calculates technical indicators for a given symbol.
 * This is the 'getIndicators' function that was missing.
 * @param {string} symbol The stock symbol.
 * @returns {Promise<object|null>} An object with indicators, or null on failure.
 */
export async function getIndicators(symbol) {
    try {
        const now = new Date();
        // Get data from up to 2 days ago to ensure enough bars for calculation
        const start = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const end = now.toISOString();

        // Common URL parameters
        const baseParams = { start, end, limit: 1000, adjustment: 'raw' };

        // Fetch 1-minute bars
        const params1m = new URLSearchParams({ ...baseParams, timeframe: '1Min' }).toString();
        const bars1m = await alpacaFetch(`/v2/stocks/${symbol}/bars?${params1m}`);

        // Fetch 5-minute bars
        const params5m = new URLSearchParams({ ...baseParams, timeframe: '5Min' }).toString();
        const bars5m = await alpacaFetch(`/v2/stocks/${symbol}/bars?${params5m}`);

        if (!bars1m.bars || bars1m.bars.length < 50 || !bars5m.bars || bars5m.bars.length < 50) {
            logMessage(`Insufficient bar data for ${symbol} to calculate indicators.`, "warning");
            return null;
        }

        const prices1m = bars1m.bars.map(b => b.c);
        const prices5m = bars5m.bars.map(b => b.c);

        return {
            symbol: symbol,
            currentPrice: prices1m[prices1m.length - 1],
            rsi1m: calculateRSI(prices1m),
            rsi5m: calculateRSI(prices5m),
            atr: calculateATR(bars5m.bars),
            macd: calculateMACD(prices5m)
        };
    } catch (e) {
        logMessage(`Failed to get indicators for ${symbol}: ${e.message}`, "error");
        return null;
    }
}


/**
 * Fetches an AI recommendation for a given stock using the Gemini API.
 * @param {string} newsHeadlines A string of recent news headlines.
 * @param {object} stockData An object containing technical indicators for the stock.
 * @returns {Promise<object|null>} The parsed JSON recommendation from the AI, or null on failure.
 */
export async function getAiRecommendationForStock(newsHeadlines, stockData) {
    const prompt = `As a Tier-1 Hedge Fund Analyst, provide a 'BUY' or 'HOLD' decision for an intraday scalping strategy.
        Base your decision on a 50/50 weighting of general market news and the stock's specific quantitative data.
        A 'BUY' is warranted if the stock shows strong technicals (bullish MACD, high ATR for volatility) and the news is supportive.
        A 'HOLD' is warranted if data is mixed, neutral, or negative. Do not recommend 'SELL'.

        Respond ONLY with the following JSON format:
        {
            "ticker": "${stockData.symbol}",
            "decision": "BUY" or "HOLD",
            "confidence": A score from 1 (low) to 10 (high) on your conviction,
            "reasoning": "Brief justification synthesizing all data points."
        }

        --- DATA ---
        **General Market News:** ${newsHeadlines}
        **Stock Specifics for ${stockData.symbol}:**
        - Price: ${stockData.currentPrice}, 5-min RSI: ${stockData.rsi5m.toFixed(2)}, 5-min ATR: ${stockData.atr.toFixed(4)}
        - 5-min MACD: ${stockData.macd.macd.toFixed(4)}, 5-min MACD Signal: ${stockData.macd.signal.toFixed(4)}
        --- END DATA ---
    `;

    try {
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${state.apiKeys.geminiKey}`;
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Gemini API Error: ${error.error.message}`);
        }

        const data = await response.json();
        // Clean up potential markdown formatting from the response
        const jsonString = data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        return JSON.parse(jsonString);

    } catch (e) {
        logMessage(`Gemini parsing failed for ${stockData.symbol}: ${e.message}`, 'error');
        return null;
    }
}

/**
 * Places a bracket order (entry, stop loss, take profit) via the Alpaca API.
 * @param {string} symbol - The stock symbol.
 * @param {number} quantity - The number of shares.
 * @param {string} side - 'buy' or 'sell'.
 * @param {string} limitPrice - The limit price for the entry order.
 * @param {string} stopPrice - The stop loss price.
 * @param {string} takeProfitPrice - The take profit price.
 */
export async function placeBracketOrder(symbol, quantity, side, limitPrice, stopPrice, takeProfitPrice) {
    const orderData = {
        symbol: symbol,
        qty: quantity,
        side: side,
        type: 'limit',
        time_in_force: 'day',
        limit_price: limitPrice,
        order_class: 'bracket',
        stop_loss: {
            stop_price: stopPrice
        },
        take_profit: {
            take_profit_price: takeProfitPrice
        }
    };

    try {
        await alpacaFetch('/v2/orders', {
            method: 'POST',
            body: JSON.stringify(orderData)
        });
        logMessage(`[${side.toUpperCase()}] Placed bracket order for ${quantity} ${symbol} @ ${limitPrice}. SL: ${stopPrice}, TP: ${takeProfitPrice}`, side);
        showToast(`Order placed for ${symbol}`, 'success');
    } catch (e) {
        logMessage(`Order for ${symbol} failed: ${e.message}`, 'error');
        showToast(`Order for ${symbol} failed`, 'error');
    }
}

/**
 * Fetches the latest account and position data from Alpaca and updates the global state.
 */
export async function updatePortfolioAndPositions() {
    try {
        const [account, positions] = await Promise.all([
            alpacaFetch('/v2/account'),
            alpacaFetch('/v2/positions')
        ]);

        const newEquity = parseFloat(account.equity);
        let newState = {
            portfolio: {
                ...state.portfolio,
                equity: newEquity
            }
        };

        // Initialize equity tracking on first run
        if (state.portfolio.initial_equity === 0) {
            newState.portfolio.initial_equity = newEquity;
        }
        if (state.portfolio.last_equity === 0) {
            newState.portfolio.last_equity = newEquity;
        }

        // Update performance data
        const today = new Date().toISOString().split('T')[0];
        let perfData = [...state.performanceData];
        const todayEntry = perfData.find(d => d.x && d.x.toISOString().split('T')[0] === today);

        if (todayEntry) {
            todayEntry.y = newEquity;
        } else {
            perfData.push({ x: new Date(), y: newEquity });
        }
        newState.performanceData = perfData;

        // Map positions to a simpler format and find stop-loss price
        newState.positions = positions.map(p => ({
            symbol: p.symbol,
            qty: p.qty,
            avg_entry_price: p.avg_entry_price,
            current_price: p.current_price,
            unrealized_pl: p.unrealized_pl,
            unrealized_plpc: p.unrealized_plpc,
            stop_price: p.stop_loss ? p.stop_loss.stop_price : null
        }));

        setState(newState);

        // Update UI elements
        updateDashboardUI();
        renderPositionsTable();
        updatePerformanceChart();

    } catch (error) {
        logMessage(`Failed to update portfolio: ${error.message}`, 'error');
        if (error instanceof AuthError) {
            throw error; // Re-throw to be caught by the main cycle
        }
    }
}

/**
 * Closes a position for a given symbol.
 * @param {string} symbol - The stock symbol to close.
 */
export async function closePositionFromApi(symbol) {
    try {
        await alpacaFetch(`/v2/positions/${symbol}`, {
            method: 'DELETE'
        });
        logMessage(`Market close order submitted for ${symbol}.`, 'sell');
    } catch (e) {
        logMessage(`Failed to submit close order for ${symbol}: ${e.message}`, 'error');
        throw e; // Re-throw to be handled by the UI
    }
}
