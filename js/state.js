/**
 * @fileoverview Manages the global state of the application.
 * This centralizes the application's data, making it easier to track and modify.
 */

import { initialState } from './config.js';

// The single source of truth for the application's state.
// We use `let` so the object can be completely replaced if needed,
// but typically it will be mutated by the setState function.
export let state = {
    ...JSON.parse(JSON.stringify(initialState)) // Deep copy to prevent mutation of the original config
};

/**
 * Updates the global state by merging a new state object.
 * This function allows for updating only parts of the state without replacing the whole object.
 * @param {object} newState - An object containing the state properties to update.
 */
export function setState(newState) {
    // A simple merge. For more complex applications, this could involve deep merging.
    for (const key in newState) {
        if (typeof newState[key] === 'object' && !Array.isArray(newState[key]) && newState[key] !== null) {
            // Merge objects deeply to avoid overwriting nested properties
            state[key] = { ...state[key], ...newState[key] };
        } else {
            state[key] = newState[key];
        }
    }
}
