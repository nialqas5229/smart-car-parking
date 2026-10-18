/**
 * js/main.js
 * Application entry point and screen coordinator.
 * Connects SmartParking logic, ParkingScene (Three.js), ParkingUI (DOM), and localStorage.
 */

import { SmartParking } from './parking.js';
import { ParkingScene } from './scene.js';
import { ParkingUI } from './ui.js';
import { saveParkingState, loadParkingState, clearParkingState } from './storage.js';

class SmartParkingApp {
  constructor() {
    this.parking = new SmartParking();
    this.ui = new ParkingUI();
    this.scene = new ParkingScene(this.ui.canvasContainer);
    this.scene.onCarClicked = (carID) => this.showCarDetails(carID);

    // Array of { carID, parkingID, color, enteredAt }
    this.records = [];

    // Counters for consecutive invalid attempts (max 3)
    this.setupInvalidAttempts = 0;
    this.carFormatAttempts = 0;

    // Lock flag while a car is animating
    this.isAnimating = false;
  }

  /**
   * Starts the app:
   * 1. Shows the Welcome screen for at least 2 seconds AND until assets/car.glb finishes loading.
   * 2. Restores saved state from localStorage if valid, or opens the Setup screen.
   */
  async init() {
    this.bindEvents();

    const minDelayPromise = new Promise((resolve) => setTimeout(resolve, 2000));
    const modelLoadPromise = this.scene.loadCarModel();

    const [, modelResult] = await Promise.all([minDelayPromise, modelLoadPromise]);
    this.ui.setFallbackWarning(modelResult.usingFallback);

    // Check if valid saved parking data exists in localStorage
    const saved = loadParkingState();
    if (saved) {
      this.restoreSavedParking(saved.capacity, saved.records);
    } else {
      this.ui.showSetupScreen();
    }

    this.ui.hideWelcomeScreen();
  }

  /**
   * Attaches event listeners for Setup, Car Control, 3D Zoom buttons, and New Parking modal.
   */
  bindEvents() {
    // Setup form submit
    this.ui.setupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleCreateParking();
    });

    // Setup "Try again" button
    this.ui.setupTryAgainBtn.addEventListener('click', () => {
      this.setupInvalidAttempts = 0;
      this.ui.resetSetupForm();
    });

    // Enter & Exit buttons
    this.ui.enterCarBtn.addEventListener('click', () => this.handleEnterCar());
    this.ui.exitCarBtn.addEventListener('click', () => this.handleExitCar());
    this.ui.carPopupCloseBtn.addEventListener('click', () => this.ui.hideCarDetails());

    // Pressing Enter key inside the Car ID input triggers Enter Car
    this.ui.carIdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleEnterCar();
      }
    });

    // 3D Viewport Zoom controls
    this.ui.zoomInBtn.addEventListener('click', () => this.scene.zoomByFactor(0.78));
    this.ui.zoomOutBtn.addEventListener('click', () => this.scene.zoomByFactor(1.28));
    this.ui.zoomFitBtn.addEventListener('click', () => this.scene.fitCameraToLot(true));

    // "New Parking" confirmation modal
    this.ui.newParkingBtn.addEventListener('click', () => {
      if (!this.isAnimating) {
        this.ui.showConfirmModal();
      }
    });
    this.ui.confirmCancelBtn.addEventListener('click', () => {
      this.ui.hideConfirmModal();
    });
    this.ui.confirmAcceptBtn.addEventListener('click', () => {
      this.ui.hideConfirmModal();
      this.resetToNewParking();
    });
  }

  /**
   * Validates capacity input (integer from 1 to 40).
   * Counts up to 3 wrong tries, then locks the form and shows "Try again".
   */
  handleCreateParking() {
    const raw = this.ui.capacityInput.value.trim();
    const isIntegerString = /^[0-9]+$/.test(raw);
    const capacity = isIntegerString ? Number(raw) : NaN;

    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 40) {
      this.setupInvalidAttempts += 1;

      if (this.setupInvalidAttempts >= 3) {
        this.ui.setSetupMessage(
          'Invalid capacity. Attempt 3 of 3. Too many invalid entries.',
          'error'
        );
        this.ui.lockSetupForm();
      } else {
        this.ui.setSetupMessage(
          `Invalid capacity. Attempt ${this.setupInvalidAttempts} of 3.`,
          'error'
        );
      }
      return;
    }

    // Valid capacity resets the counter and initializes the parking lot
    this.setupInvalidAttempts = 0;
    this.parking.createParking(capacity);
    this.records = [];
    saveParkingState(this.parking.capacity, this.records);

    this.ui.showDashboardScreen();
    this.scene.handleResize();
    this.scene.buildParkingLot(capacity);
    this.syncDashboardUI();

    if (this.scene.usingFallbackModel) {
      this.ui.setControlMessage(
        'Note: assets/car.glb not found — using built-in 3D car model.',
        'info'
      );
    } else {
      this.ui.setControlMessage('Parking lot created. Enter a Car ID (e.g. LEA-123).', 'info');
    }
  }

  /**
   * Restores a saved parking lot and places all parked cars immediately with no animation.
   */
  restoreSavedParking(capacity, savedRecords) {
    this.parking.createParking(capacity);
    this.records = [];

    this.ui.showDashboardScreen();
    this.scene.handleResize();
    this.scene.buildParkingLot(capacity);

    for (const rec of savedRecords) {
      this.parking.enter(rec.carID, rec.parkingID);
      this.records.push(rec);
      this.scene.placeCarInstant(rec.carID, rec.parkingID, rec.color);
    }

    this.syncDashboardUI();
    this.ui.setControlMessage('Saved parking lot restored.', 'info');
  }

  /**
   * Validates the Car ID format (3 uppercase letters, dash, 3 digits).
   * Only FORMAT errors increment the 3-try counter.
   * After 3 consecutive format errors, shows:
   * "Too many invalid entries. Returning to main menu."
   * clears the input, and resets the counter.
   *
   * @param {string} carID
   * @returns {boolean}
   */
  validateCarIdFormat(carID) {
    if (!SmartParking.isValidCarId(carID)) {
      this.carFormatAttempts += 1;

      if (this.carFormatAttempts >= 3) {
        this.ui.setControlMessage(
          'Too many invalid entries. Returning to main menu.',
          'error'
        );
        this.ui.carIdInput.value = '';
        this.carFormatAttempts = 0;
        this.scene.fitCameraToLot(true);
      } else {
        this.ui.setControlMessage(
          `Invalid Car ID. Attempt ${this.carFormatAttempts} of 3.`,
          'error'
        );
      }
      return false;
    }

    // A valid format immediately resets the consecutive format error counter
    this.carFormatAttempts = 0;
    return true;
  }

  /**
   * Handles the ENTER flow:
   * 1. Validate ID format and parking rules.
   * 2. Auto-select the free slot nearest to the ENTRY gate and reserve it in logic.
   * 3. Assign a unique bright color and spawn the car at the ENTRY gate.
   * 4. Animate smoothly along the road and into the slot while showing "Please wait...".
   * 5. Add the record to the right panel, save to localStorage, and show success message.
   */
  async handleEnterCar() {
    if (this.isAnimating) return;

    const carID = this.ui.carIdInput.value.trim();
    if (!this.validateCarIdFormat(carID)) {
      return;
    }

    // Rule checks (do NOT count toward format attempts)
    if (this.parking.hasCar(carID)) {
      this.ui.setControlMessage('Car already parked', 'error');
      return;
    }

    if (this.parking.availableSlots() === 0) {
      this.ui.setControlMessage('Parking is full', 'error');
      return;
    }

    // Find nearest free slot to the ENTRY gate (ties broken by lower Parking ID)
    const occupiedSlots = this.parking.getOccupiedSlotIds();
    const targetSlotId = this.scene.findNearestFreeSlot(occupiedSlots);

    // Reserve immediately in pure logic class
    const assignedSlotId = this.parking.enter(carID, targetSlotId);

    // Pick a unique bright color not used by any currently parked car
    const usedColors = this.records.map((r) => r.color);
    const carColor = this.scene.pickUniqueCarColor(usedColors);
    const enteredAt = this.getCurrentTimeHHMM();

    // Disable controls and show "Please wait..." while the car is moving
    this.isAnimating = true;
    this.ui.setControlsBusy(true);
    this.ui.setControlMessage('Please wait...', 'info');

    await this.scene.fitCameraToLot(true);
    await this.scene.animateCarEnter(carID, assignedSlotId, carColor);

    // When the car arrives, add record, persist to localStorage, and update UI
    this.records.push({
      carID,
      parkingID: assignedSlotId,
      color: carColor,
      enteredAt
    });
    saveParkingState(this.parking.capacity, this.records);

    this.ui.carIdInput.value = '';
    this.syncDashboardUI();
    await this.scene.fitCameraToLot(true);
    this.isAnimating = false;
    this.ui.setControlsBusy(false);
    this.ui.carIdInput.focus();
    this.ui.setControlMessage(`Car ${carID} parked successfully.`, 'success');
  }

  /**
   * Handles the EXIT flow:
   * 1. Validate ID format and check that the car is currently parked.
   * 2. Animate the car pulling out of its slot, driving to the EXIT gate, and fading out.
   * 3. Free the slot in logic, remove the record, and save to localStorage.
   */
  async handleExitCar(selectedCarID = null) {
    if (this.isAnimating) return;

    const carID = selectedCarID || this.ui.carIdInput.value.trim();
    if (!selectedCarID && !this.validateCarIdFormat(carID)) {
      return;
    }

    // Rule check: car must be in parking
    if (!this.parking.hasCar(carID)) {
      this.ui.setControlMessage(`Car ID ${carID} is not in parking`, 'error');
      return;
    }

    this.isAnimating = true;
    this.ui.setCarPopupExiting(true);
    this.ui.setControlsBusy(true);
    this.ui.setControlMessage('Please wait...', 'info');

    await this.scene.fitCameraToLot(true);
    await this.scene.animateCarExit(carID);
    this.ui.hideCarDetails();

    // Update pure logic and remove record
    this.parking.exit(carID);
    this.records = this.records.filter((r) => r.carID !== carID);
    saveParkingState(this.parking.capacity, this.records);

    this.ui.setCarPopupExiting(false);
    this.ui.carIdInput.value = '';
    this.syncDashboardUI();
    await this.scene.fitCameraToLot(true);
    this.isAnimating = false;
    this.ui.setControlsBusy(false);
    this.ui.carIdInput.focus();
    this.ui.setControlMessage(`Car ${carID} removed from parking.`, 'success');
  }

  /**
   * Updates stats, occupancy bar, and the right-hand records panel.
   */
  syncDashboardUI() {
    const total = this.parking.capacity;
    const occupied = total - this.parking.availableSlots();
    this.ui.updateStats(total, occupied);

    this.ui.renderRecords(this.records, (carID) => {
      this.scene.focusOnCar(carID);
    });
  }

  showCarDetails(carID) {
    const record = this.records.find((item) => item.carID === carID);
    if (!record) return;
    this.scene.focusOnCar(carID);
    this.ui.showCarDetails(record, (selectedCarID) => this.handleExitCar(selectedCarID));
  }

  /**
   * Clears localStorage, 3D scene, and returns to the Setup screen.
   */
  resetToNewParking() {
    clearParkingState();
    this.records = [];
    this.carFormatAttempts = 0;
    this.setupInvalidAttempts = 0;
    this.scene.clearSceneObjects();
    this.ui.showSetupScreen();
  }

  /**
   * Formats the current local time as HH:MM (24-hour).
   * @returns {string}
   */
  getCurrentTimeHHMM() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new SmartParkingApp();
  app.init();
});
