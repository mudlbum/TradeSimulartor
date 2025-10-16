/**
 * @fileoverview Provides utility functions for the application, including
 * technical indicator calculations (RSI, ATR, MACD) and market status checks.
 * These are pure functions that don't depend on the global state.
 */

/**
 * Calculates the Relative Strength Index (RSI).
 * @param {number[]} prices - An array of closing prices.
 * @param {number} [period=14] - The lookback period for the RSI calculation.
 * @returns {number} The calculated RSI value.
 */
export function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50; // Return neutral value if not enough data

    let gains = 0;
    let losses = 0;

    // Calculate initial average gains and losses
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) {
            gains += diff;
        } else {
            losses -= diff;
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smooth the averages for the rest of the prices
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }

    if (avgLoss === 0) return 100; // Prevent division by zero

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/**
 * Calculates the Average True Range (ATR).
 * @param {object[]} bars - An array of market bars, each with {h, l, c} properties (high, low, close).
 * @param {number} [period=14] - The lookback period for the ATR calculation.
 * @returns {number} The calculated ATR value.
 */
export function calculateATR(bars, period = 14) {
    if (bars.length < period) return 0;

    let trueRanges = [];
    for (let i = 1; i < bars.length; i++) {
        const high = bars[i].h;
        const low = bars[i].l;
        const prevClose = bars[i - 1].c;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
    }

    // Simple Moving Average for the ATR
    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr;
}

/**
 * Calculates the Moving Average Convergence Divergence (MACD).
 * @param {number[]} prices - An array of closing prices.
 * @param {number} [shortPeriod=12] - The short-term EMA period.
 * @param {number} [longPeriod=26] - The long-term EMA period.
 * @param {number} [signalPeriod=9] - The signal line EMA period.
 * @returns {{macd: number, signal: number, histogram: number}} An object containing the MACD line, signal line, and histogram.
 */
export function calculateMACD(prices, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
    if (prices.length < longPeriod) return { macd: 0, signal: 0, histogram: 0 };

    const calculateEMA = (data, period) => {
        const k = 2 / (period + 1);
        let ema = [data[0]];
        for (let i = 1; i < data.length; i++) {
            ema.push(data[i] * k + ema[i - 1] * (1 - k));
        }
        return ema;
    };

    const shortEMA = calculateEMA(prices, shortPeriod);
    const longEMA = calculateEMA(prices, longPeriod);
    const macdLine = [];

    // Align the EMAs and calculate the MACD line
    for (let i = longPeriod - 1; i < prices.length; i++) {
        macdLine.push(shortEMA[i - (longPeriod - shortPeriod)] - longEMA[i]);
    }

    if (macdLine.length < signalPeriod) return { macd: 0, signal: 0, histogram: 0 };

    const signalLine = calculateEMA(macdLine, signalPeriod);
    const macd = macdLine[macdLine.length - 1];
    const signal = signalLine[signalLine.length - 1];

    return { macd, signal, histogram: macd - signal };
}


/**
 * Checks if the US stock market is currently open.
 * @returns {boolean} True if the market is open, otherwise false.
 */
export function isMarketOpen() {
    const now = new Date();
    // Use a specific time zone to avoid issues with the user's local time
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const day = est.getDay(); // Sunday = 0, Saturday = 6
    const hour = est.getHours();
    const minute = est.getMinutes();

    // Market is closed on weekends
    if (day === 0 || day === 6) return false;

    // Market is open from 9:30 AM to 4:00 PM EST
    if (hour < 9 || (hour === 9 && minute < 30)) return false; // Before 9:30 AM
    if (hour >= 16) return false; // After 4:00 PM

    return true;
}
