/**
 * js/parking.js
 * Pure parking logic class with formal preconditions, postconditions, and class invariant.
 * Notice: No DOM code and no Three.js code is allowed in this file.
 */

// Car ID must be 3 uppercase letters, a hyphen, and 3 digits (example: LEA-123)
export const CAR_ID_REGEX = /^[A-Z]{3}-[0-9]{3}$/;

export class SmartParking {
  constructor() {
    // Capacity C of the parking lot
    this.capacity = 0;

    // Map of carID -> parkingID (this represents the parked set P)
    this.parkedCars = new Map();
  }

  /**
   * Formats a 1-based slot number into a Parking ID like "P-01", "P-12".
   * @param {number} index1Based
   * @returns {string}
   */
  static formatSlotId(index1Based) {
    return `P-${String(index1Based).padStart(2, '0')}`;
  }

  /**
   * Validates whether a Car ID string matches /^[A-Z]{3}-[0-9]{3}$/.
   * Does not auto-correct lowercase letters.
   * @param {string} carID
   * @returns {boolean}
   */
  static isValidCarId(carID) {
    return typeof carID === 'string' && CAR_ID_REGEX.test(carID);
  }

  /**
   * Checks the class invariant:
   * C > 0 AND 0 <= |P| <= C AND no duplicate Car IDs or duplicate Slot IDs.
   * Throws an Error if the invariant is broken.
   */
  checkInvariant() {
    const cValid = Number.isInteger(this.capacity) && this.capacity > 0;
    const size = this.parkedCars.size;
    const sizeValid = size >= 0 && size <= this.capacity;

    // Map keys are unique by definition, and we also verify all assigned slot IDs are unique and valid
    const usedSlots = new Set();
    for (const [carID, slotID] of this.parkedCars.entries()) {
      if (!SmartParking.isValidCarId(carID)) {
        throw new Error(`Invariant violation: invalid Car ID "${carID}" in parked set P.`);
      }
      if (usedSlots.has(slotID)) {
        throw new Error(`Invariant violation: duplicate slot "${slotID}" assigned.`);
      }
      usedSlots.add(slotID);
    }

    if (!cValid || !sizeValid) {
      throw new Error(
        `Invariant violation: C=${this.capacity}, |P|=${size}. Expected C > 0 and 0 <= |P| <= C.`
      );
    }
  }

  /**
   * Initializes a new parking lot with the given capacity.
   * Precondition: capacity > 0 (integer from 1 to 40)
   * Postcondition: P is empty (|P| === 0) and C = capacity
   *
   * @param {number} capacity
   */
  createParking(capacity) {
    // Precondition check
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Precondition failed: capacity must be a positive integer (capacity > 0).');
    }

    this.capacity = capacity;
    this.parkedCars.clear();

    // Postcondition & Invariant check
    if (this.parkedCars.size !== 0 || this.capacity !== capacity) {
      throw new Error('Postcondition failed: P must be empty and C must equal capacity.');
    }
    this.checkInvariant();
  }

  /**
   * Parks a car in the nearest available slot (or a provided free slot).
   * Precondition: carID not in P AND |P| < C
   * Postcondition: carID in P and |P| increased by 1
   *
   * @param {string} carID
   * @param {string} [preferredSlotId] - Optional specific free slot ID chosen by distance calculator
   * @returns {string} The assigned parkingID (e.g. "P-01")
   */
  enter(carID, preferredSlotId = null) {
    this.checkInvariant();

    const oldSize = this.parkedCars.size;

    // Precondition check
    if (!SmartParking.isValidCarId(carID)) {
      throw new Error('Invalid Car ID format.');
    }
    if (this.parkedCars.has(carID)) {
      throw new Error('Car already parked');
    }
    if (oldSize >= this.capacity) {
      throw new Error('Parking is full');
    }

    // Find which slots are currently occupied
    const occupiedSlots = new Set(this.parkedCars.values());
    let chosenSlot = preferredSlotId;

    if (chosenSlot) {
      if (occupiedSlots.has(chosenSlot)) {
        throw new Error(`Preferred slot ${chosenSlot} is already occupied.`);
      }
    } else {
      // Default fallback: lowest numbered free Parking ID
      for (let i = 1; i <= this.capacity; i++) {
        const candidate = SmartParking.formatSlotId(i);
        if (!occupiedSlots.has(candidate)) {
          chosenSlot = candidate;
          break;
        }
      }
    }

    this.parkedCars.set(carID, chosenSlot);

    // Postcondition check: carID in P and |P| increased by 1
    if (!this.parkedCars.has(carID) || this.parkedCars.size !== oldSize + 1) {
      throw new Error('Postcondition failed in enter().');
    }

    this.checkInvariant();
    return chosenSlot;
  }

  /**
   * Removes a parked car from the parking lot.
   * Precondition: carID in P
   * Postcondition: carID not in P and |P| decreased by 1
   *
   * @param {string} carID
   * @returns {string} The freed parkingID
   */
  exit(carID) {
    this.checkInvariant();

    const oldSize = this.parkedCars.size;

    // Precondition check
    if (!this.parkedCars.has(carID)) {
      throw new Error(`Car ID ${carID} is not in parking`);
    }

    const freedSlot = this.parkedCars.get(carID);
    this.parkedCars.delete(carID);

    // Postcondition check: carID not in P and |P| decreased by 1
    if (this.parkedCars.has(carID) || this.parkedCars.size !== oldSize - 1) {
      throw new Error('Postcondition failed in exit().');
    }

    this.checkInvariant();
    return freedSlot;
  }

  /**
   * Returns the number of free parking slots without modifying state.
   * Precondition: C > 0
   * Postcondition: returns C - |P|, no state change
   *
   * @returns {number}
   */
  availableSlots() {
    this.checkInvariant();
    return this.capacity - this.parkedCars.size;
  }

  /**
   * Helper to check if a car is already parked.
   * @param {string} carID
   * @returns {boolean}
   */
  hasCar(carID) {
    return this.parkedCars.has(carID);
  }

  /**
   * Helper to get the slot ID for a parked car.
   * @param {string} carID
   * @returns {string|undefined}
   */
  getSlotForCar(carID) {
    return this.parkedCars.get(carID);
  }

  /**
   * Returns an array of all currently occupied slot IDs.
   * @returns {string[]}
   */
  getOccupiedSlotIds() {
    return Array.from(this.parkedCars.values());
  }
}
