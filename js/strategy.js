/**
 * @fileoverview Encapsulates the core trading strategies.
 * This module contains the logic for AI-driven market analysis
 * and the technical rules for entering trades (scalping).
 */

import { state, setState } from './state.js';
import { logMessage } from './ui.js';
import { alpacaFetch, getIndicators, getAiRecommendationForStock, placeBracketOrder } from './api.js';

/**
 * Runs the AI analysis to update the watchlist with high-potential stocks.
 */
export async function runAiDrivenAnalysis() {
    if (!state.isBotRunning) return;
    logMessage("Executing periodic AI market analysis.", "signal");
    try {
        // Fetch a list of the day's most active stocks as candidates
        const moversData = await alpacaFetch('/v1beta1/screener/stocks/most-actives?top=10');
        if (!moversData || moversData.most_actives.length === 0) {
            logMessage("Could not identify any market movers. AI analysis paused.", "action");
            return;
        }
        const candidates = moversData.most_actives;

        // Fetch recent news headlines to provide market context to the AI
        const newsData = await alpacaFetch('/v1beta1/news?limit=50&sort=desc');
        const headlines = (newsData.news || []).map(item => item.headline).join('\n');
        if (!headlines) {
            logMessage("No recent headlines found. AI will rely on technicals only.", "action");
        }

        const recommendedStocks = [];
        for (const candidate of candidates) {
            const symbol = candidate.symbol;
            logMessage(`AI analyzing candidate: ${symbol}`, "action");
            try {
                const indicators = await getIndicators(symbol);
                if (!indicators) {
                    logMessage(`Insufficient technical data for ${symbol}. Skipping.`, "action");
                    continue;
                }

                const recommendation = await getAiRecommendationForStock(headlines, indicators);

                // Add to list if AI recommends a BUY with sufficient confidence
                if (recommendation && recommendation.decision === 'BUY' && recommendation.confidence >= 7) {
                    recommendedStocks.push({ ...recommendation, ...indicators });
                }
            } catch (e) {
                logMessage(`Error analyzing ${symbol}: ${e.message}`, 'error');
            }
        }

        if (recommendedStocks.length > 0) {
            const sortedRecommendations = recommendedStocks.sort((a, b) => b.confidence - a.confidence);
            setState({ aiWatchlist: sortedRecommendations });
            const tickers = sortedRecommendations.map(s => `${s.ticker} (Conf: ${s.confidence})`).join(', ');
            logMessage(`AI analysis complete. New watchlist: ${tickers}`, "signal");
        } else {
            logMessage("AI analysis did not yield any new high-confidence recommendations.", "action");
            // Keep the old list if no new recommendations are found
        }
        
        // This function is defined in ui.js but needs to be called after state update
        // We will import and call it in app.js after this function resolves
        // For now, assume it will be handled by the main app logic.
        // renderAiWatchlist(); 

    } catch (e) {
        logMessage(`AI analysis failed: ${e.message}`, 'error');
    }
}

/**
 * Scans the AI watchlist for technical entry signals and executes trades.
 */
export async function runScalpingStrategy() {
    logMessage("Executing scalping scan.", "signal");
    if (state.aiWatchlist.length === 0) return;

    if (state.positions.length >= state.settings.maxConcurrentScalps) {
        logMessage("Max concurrent positions reached.", "action");
        return;
    }

    // First trade of the day is based purely on the AI's top recommendation
    if (!state.isFirstTradeMadeToday) {
        logMessage("Attempting first trade of the day based on pure AI conviction.", "signal");
        const stock = state.aiWatchlist[0];
        if (stock && !state.positions.some(p => p.symbol === stock.ticker)) {
            await executeTrade(stock);
            setState({ isFirstTradeMadeToday: true });
            return; // Exit after attempting the first trade
        }
    }

    // Subsequent trades are based on a technical pullback entry signal
    logMessage("Scanning for entries based on technical analysis.", "action");
    for (const stock of state.aiWatchlist) {
        if (state.positions.some(p => p.symbol === stock.ticker)) continue;
        if (state.positions.length >= state.settings.maxConcurrentScalps) break;


        const is5minTrendBullish = stock.macd.histogram > 0;
        const isRsiPullback = stock.rsi1m < 45; // Entry condition on 1-min chart

        if (is5minTrendBullish && isRsiPullback) {
            logMessage(`Entry signal for ${stock.ticker}: 5m MACD is bullish and 1m RSI is ${stock.rsi1m.toFixed(2)} (below 45)`, 'buy');
            await executeTrade(stock);
        }
    }
}


/**
 * Calculates trade size and places a bracket order for a given stock.
 * This function is internal to the strategy module.
 * @param {object} stock - The stock object from the AI watchlist.
 */
async function executeTrade(stock) {
    try {
        const symbol = stock.ticker;
        const quote = await alpacaFetch(`/v2/stocks/${symbol}/quotes/latest`);
        if (!quote || !quote.quote || !quote.quote.ap || !quote.quote.bp) {
            throw new Error("Invalid quote received from API.");
        }
        const currentPrice = quote.quote.ap; // Ask Price for entry calculation

        const capitalToRisk = state.portfolio.equity * (state.settings.riskPerTrade / 100);
        const stopLossDistance = 2 * stock.atr; // Stop loss is 2x ATR
        const quantity = Math.floor(capitalToRisk / stopLossDistance);

        if (quantity > 0) {
            const stopPrice = (currentPrice - stopLossDistance).toFixed(2);
            const takeProfitPrice = (currentPrice + (stopLossDistance * 1.5)).toFixed(2); // 1.5:1 risk/reward
            // Place limit order slightly above the bid to increase fill chance
            const limitPrice = (quote.quote.bp * (1 + (state.settings.limitOrderOffset / 100))).toFixed(2);

            logMessage(`Sizing trade for ${symbol}: ${quantity} shares, SL @ $${stopPrice}, TP @ $${takeProfitPrice}`, 'action');
            await placeBracketOrder(symbol, quantity, 'buy', limitPrice, stopPrice, takeProfitPrice);
        } else {
             logMessage(`Trade size for ${symbol} is zero due to risk parameters. Skipping.`, 'action');
        }
    } catch (e) {
        logMessage(`Could not execute trade for ${stock.ticker}: ${e.message}`, 'error');
    }
}

