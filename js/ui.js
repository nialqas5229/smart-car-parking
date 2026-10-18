/**
 * js/ui.js
 * Handles all DOM updates, messages, stat tiles, occupancy bar, records list, and modal dialogs.
 */

export class ParkingUI {
  constructor() {
    // Screens
    this.welcomeScreen = document.getElementById('welcome-screen');
    this.setupScreen = document.getElementById('setup-screen');
    this.dashboardScreen = document.getElementById('dashboard-screen');

    // Setup screen elements
    this.setupForm = document.getElementById('setup-form');
    this.capacityInput = document.getElementById('capacity-input');
    this.setupMessage = document.getElementById('setup-message');
    this.createParkingBtn = document.getElementById('create-parking-btn');
    this.setupTryAgainBtn = document.getElementById('setup-try-again-btn');

    // Top bar elements
    this.modelWarningBadge = document.getElementById('model-warning-badge');
    this.capacityChip = document.getElementById('capacity-chip');
    this.newParkingBtn = document.getElementById('new-parking-btn');

    // Left panel elements
    this.carIdInput = document.getElementById('car-id-input');
    this.enterCarBtn = document.getElementById('enter-car-btn');
    this.exitCarBtn = document.getElementById('exit-car-btn');
    this.controlMessage = document.getElementById('control-message');
    this.statTotal = document.getElementById('stat-total');
    this.statOccupied = document.getElementById('stat-occupied');
    this.statAvailable = document.getElementById('stat-available');
    this.occupancyPercent = document.getElementById('occupancy-percent');
    this.occupancyFill = document.getElementById('occupancy-fill');
    this.occupancyProgressbar = document.getElementById('occupancy-progressbar');

    // Center 3D view controls
    this.canvasContainer = document.getElementById('canvas-container');
    this.zoomInBtn = document.getElementById('zoom-in-btn');
    this.zoomOutBtn = document.getElementById('zoom-out-btn');
    this.zoomFitBtn = document.getElementById('zoom-fit-btn');
    this.carDetailsPopup = document.getElementById('car-details-popup');
    this.carPopupId = document.getElementById('car-popup-id');
    this.carPopupSlot = document.getElementById('car-popup-slot');
    this.carPopupTime = document.getElementById('car-popup-time');
    this.carPopupSwatch = document.getElementById('car-popup-swatch');
    this.carPopupCloseBtn = document.getElementById('car-popup-close');
    this.carPopupExitBtn = document.getElementById('car-popup-exit');
    document.addEventListener('pointerdown', (event) => {
      if (!this.carDetailsPopup.classList.contains('hidden') && !this.carDetailsPopup.contains(event.target)) {
        this.hideCarDetails();
      }
    });

    // Right panel records
    this.recordsCountBadge = document.getElementById('records-count-badge');
    this.recordsList = document.getElementById('records-list');

    // Confirmation modal
    this.confirmModal = document.getElementById('confirm-modal');
    this.confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    this.confirmAcceptBtn = document.getElementById('confirm-accept-btn');

    this.activeRecordCarId = null;
    this.controlMessageTimer = null;
  }

  /**
   * Fades out the Welcome screen and reveals the target screen.
   */
  hideWelcomeScreen() {
    this.welcomeScreen.classList.add('fade-out');
    setTimeout(() => {
      this.welcomeScreen.classList.add('hidden');
    }, 460);
  }

  /**
   * Shows the Setup screen and hides the Dashboard screen.
   */
  showSetupScreen() {
    this.dashboardScreen.classList.add('hidden');
    this.setupScreen.classList.remove('hidden');
    this.resetSetupForm();
  }

  /**
   * Resets the Setup form inputs, buttons, and error messages.
   */
  resetSetupForm() {
    this.capacityInput.disabled = false;
    this.capacityInput.value = '';
    this.createParkingBtn.disabled = false;
    this.createParkingBtn.classList.remove('hidden');
    this.setupTryAgainBtn.classList.add('hidden');
    this.setupMessage.classList.add('hidden');
    this.setupMessage.textContent = '';
    this.capacityInput.focus();
  }

  /**
   * Displays a status/error message on the Setup screen.
   * @param {string} text
   * @param {'error'|'info'|'success'} type
   */
  setSetupMessage(text, type = 'error') {
    this.setupMessage.textContent = text;
    this.setupMessage.className = `message-box msg-${type}`;
  }

  /**
   * Locks the Setup form after 3 wrong tries and reveals the "Try again" button.
   */
  lockSetupForm() {
    this.capacityInput.disabled = true;
    this.createParkingBtn.disabled = true;
    this.setupTryAgainBtn.classList.remove('hidden');
    this.setupTryAgainBtn.focus();
  }

  /**
   * Shows the main 3D Dashboard screen.
   */
  showDashboardScreen() {
    this.setupScreen.classList.add('hidden');
    this.dashboardScreen.classList.remove('hidden');
  }

  /**
   * Shows or hides the fallback car model warning badge in the top bar.
   * @param {boolean} show
   */
  setFallbackWarning(show) {
    if (show) {
      this.modelWarningBadge.classList.remove('hidden');
    } else {
      this.modelWarningBadge.classList.add('hidden');
    }
  }

  /**
   * Displays a message in the Left Panel Car Control message box.
   * @param {string} text
   * @param {'success'|'error'|'info'} type
   */
  setControlMessage(text, type = 'info') {
    clearTimeout(this.controlMessageTimer);
    this.controlMessage.textContent = text;
    this.controlMessage.className = `message-box msg-${type}`;
    this.controlMessageTimer = setTimeout(() => {
      this.controlMessage.textContent = '';
      this.controlMessage.className = 'message-box hidden';
    }, 2000);
  }

  /**
   * Enables or disables the Enter and Exit buttons while a car animation is running.
   * @param {boolean} busy
   */
  setControlsBusy(busy) {
    this.enterCarBtn.disabled = busy;
    this.exitCarBtn.disabled = busy;
    this.carIdInput.disabled = busy;
    this.newParkingBtn.disabled = busy;
  }

  /**
   * Updates the Top Bar capacity chip, the 3 stat tiles (Total, Occupied, Available),
   * and the occupancy progress bar with percentage.
   *
   * @param {number} total
   * @param {number} occupied
   */
  updateStats(total, occupied) {
    const available = Math.max(0, total - occupied);
    const percent = total > 0 ? Math.round((occupied / total) * 100) : 0;

    this.capacityChip.textContent = `Capacity: ${total}`;
    this.statTotal.textContent = String(total);
    this.statOccupied.textContent = String(occupied);
    this.statAvailable.textContent = String(available);

    this.occupancyPercent.textContent = `${percent}%`;
    this.occupancyFill.style.width = `${percent}%`;
    this.occupancyProgressbar.setAttribute('aria-valuenow', String(percent));
  }

  /**
   * Renders the Right Panel "Parking Records" list.
   * Clicking any row triggers onRowClick(carID) to highlight the car and move the camera.
   *
   * @param {Array<{carID: string, parkingID: string, color: string, enteredAt: string}>} records
   * @param {(carID: string) => void} onRowClick
   */
  renderRecords(records, onRowClick) {
    this.recordsCountBadge.textContent = String(records.length);
    this.recordsList.innerHTML = '';

    if (records.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'records-empty';
      emptyDiv.textContent = 'No cars currently parked.';
      this.recordsList.appendChild(emptyDiv);
      return;
    }

    for (const rec of records) {
      const rowBtn = document.createElement('button');
      rowBtn.type = 'button';
      rowBtn.className = 'record-row';
      rowBtn.dataset.carId = rec.carID;
      rowBtn.setAttribute('role', 'listitem');
      if (this.activeRecordCarId === rec.carID) {
        rowBtn.classList.add('active');
      }

      const leftDiv = document.createElement('div');
      leftDiv.className = 'record-left';

      const colorDot = document.createElement('span');
      colorDot.className = 'car-color-dot';
      colorDot.style.backgroundColor = rec.color;

      const carIdSpan = document.createElement('span');
      carIdSpan.className = 'record-car-id';
      carIdSpan.textContent = rec.carID;

      leftDiv.appendChild(colorDot);
      leftDiv.appendChild(carIdSpan);

      const rightDiv = document.createElement('div');
      rightDiv.className = 'record-right';

      const slotChip = document.createElement('span');
      slotChip.className = 'slot-chip';
      slotChip.textContent = rec.parkingID;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'record-time';
      timeSpan.textContent = rec.enteredAt;

      rightDiv.appendChild(slotChip);
      rightDiv.appendChild(timeSpan);

      rowBtn.appendChild(leftDiv);
      rowBtn.appendChild(rightDiv);

      rowBtn.addEventListener('click', () => {
        this.activeRecordCarId = rec.carID;
        const allRows = this.recordsList.querySelectorAll('.record-row');
        allRows.forEach((el) => el.classList.remove('active'));
        rowBtn.classList.add('active');
        onRowClick(rec.carID);
      });

      this.recordsList.appendChild(rowBtn);
    }
  }

  showCarDetails(record, onExit) {
    if (!record) return;
    this.activeRecordCarId = record.carID;
    this.carPopupId.textContent = record.carID;
    this.carPopupSlot.textContent = record.parkingID;
    this.carPopupTime.textContent = record.enteredAt;
    this.carPopupSwatch.style.backgroundColor = record.color;
    this.carPopupExitBtn.disabled = false;
    this.carPopupExitBtn.textContent = 'Exit Car';
    this.carPopupExitBtn.onclick = () => onExit(record.carID);
    this.carDetailsPopup.classList.remove('hidden');
    this.recordsList.querySelectorAll('.record-row').forEach((row) => {
      row.classList.toggle('active', row.dataset.carId === record.carID);
    });
  }

  setCarPopupExiting(exiting) {
    this.carPopupExitBtn.disabled = exiting;
    this.carPopupExitBtn.textContent = exiting ? 'Please wait...' : 'Exit Car';
  }

  hideCarDetails() {
    this.carDetailsPopup.classList.add('hidden');
  }

  /**
   * Opens the confirmation modal for "New Parking".
   */
  showConfirmModal() {
    this.confirmModal.classList.remove('hidden');
  }

  /**
   * Hides the confirmation modal.
   */
  hideConfirmModal() {
    this.confirmModal.classList.add('hidden');
  }
}
