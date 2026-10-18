/**
 * js/storage.js
 * Saves and loads parking lot state in localStorage.
 * Wraps JSON.parse and storage calls in try/catch blocks and validates invariants.
 */

import { SmartParking } from './parking.js';

const STORAGE_KEY = 'smart_car_parking_state_v1';

/**
 * Saves the current capacity and array of parked car records to localStorage.
 * Each record has: { carID, parkingID, color, enteredAt }
 *
 * @param {number} capacity
 * @param {Array<{carID: string, parkingID: string, color: string, enteredAt: string}>} records
 */
export function saveParkingState(capacity, records) {
  try {
    const payload = {
      capacity,
      records
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not save parking state to localStorage:', err);
  }
}

/**
 * Loads and validates saved parking state from localStorage.
 * If data is missing, corrupted, or breaks the SmartParking invariant,
 * clears storage and returns null so the Setup screen is shown.
 *
 * @returns {{ capacity: number, records: Array<{carID: string, parkingID: string, color: string, enteredAt: string}> } | null}
 */
export function loadParkingState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      clearParkingState();
      return null;
    }

    const { capacity, records } = parsed;

    // Capacity must be an integer between 1 and 40
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 40) {
      clearParkingState();
      return null;
    }

    if (!Array.isArray(records) || records.length > capacity) {
      clearParkingState();
      return null;
    }

    // Verify all records using a test SmartParking instance to guarantee the invariant holds
    const testParking = new SmartParking();
    testParking.createParking(capacity);

    const validSlotSet = new Set();
    for (let i = 1; i <= capacity; i++) {
      validSlotSet.add(SmartParking.formatSlotId(i));
    }

    const sanitizedRecords = [];
    for (const item of records) {
      if (!item || typeof item !== 'object') {
        clearParkingState();
        return null;
      }
      const { carID, parkingID, color, enteredAt } = item;

      if (!SmartParking.isValidCarId(carID)) {
        clearParkingState();
        return null;
      }
      if (typeof parkingID !== 'string' || !validSlotSet.has(parkingID)) {
        clearParkingState();
        return null;
      }
      if (typeof color !== 'string' || !color.trim()) {
        clearParkingState();
        return null;
      }
      if (typeof enteredAt !== 'string' || !enteredAt.trim()) {
        clearParkingState();
        return null;
      }

      // Test entering into the pure logic class (verifies no duplicates and respects invariant)
      testParking.enter(carID, parkingID);
      sanitizedRecords.push({ carID, parkingID, color, enteredAt });
    }

    testParking.checkInvariant();
    return {
      capacity,
      records: sanitizedRecords
    };
  } catch (err) {
    console.warn('Corrupted or invalid saved state detected. Resetting storage:', err);
    clearParkingState();
    return null;
  }
}

/**
 * Removes saved parking data from localStorage.
 */
export function clearParkingState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Could not clear localStorage:', err);
  }
}
