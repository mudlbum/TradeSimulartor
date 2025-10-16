/**
 * @fileoverview Handles all API communications for the trading bot.
 * This includes fetching data from Alpaca, sending orders, and getting AI analysis from Gemini.
 * It also includes robust error handling and rate-limit backoff logic.
 */

import { state } from './state.js';
import { logMessage, showToast } from './ui.js';

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
