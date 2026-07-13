/**
 * @file packages/core/src/devices/doorbell.ts
 * @description Doorbell device class exposing the Matter Switch (MomentarySwitch) and Chime client cluster.
 * @author Ludovic BOUÉ
 * @created 2026-07-13
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026, 2027, 2028 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { AnsiLogger } from 'node-ansi-logger';

// Matterbridge
import { doorbell, powerSource } from '../matterbridgeDeviceTypes.js';
import { MatterbridgeEndpoint } from '../matterbridgeEndpoint.js';

export interface DoorbellOptions {
  /** Whether the device is battery powered. Defaults to false (wired). */
  batteryPowered?: boolean;
}

/**
 * Matterbridge endpoint representing a doorbell button.
 * A Doorbell device is a switch which, when pressed, usually causes a bound Chime device to activate.
 */
export class Doorbell extends MatterbridgeEndpoint {
  /**
   * Creates a Doorbell endpoint and configures the Switch and Chime client clusters.
   *
   * @param {string} name - Human-readable device name.
   * @param {string} serial - Device serial number.
   * @param {DoorbellOptions} [options] - Optional initial configuration.
   */
  constructor(name: string, serial: string, options: DoorbellOptions = {}) {
    super([doorbell, powerSource], { id: `${name.replaceAll(' ', '')}-${serial.replaceAll(' ', '')}` });

    this.createDefaultIdentifyClusterServer();
    this.createDefaultBasicInformationClusterServer(name, serial, 0xfff1, 'Matterbridge', 0x8000, 'Matterbridge Doorbell');
    if (options.batteryPowered) {
      this.createDefaultPowerSourceBatteryClusterServer();
    } else {
      this.createDefaultPowerSourceWiredClusterServer();
    }
    this.addRequiredClusters();
  }

  /**
   * Simulates a single press of the doorbell button, which typically triggers a bound Chime device to play a sound.
   *
   * @param {AnsiLogger} [log] - Optional logger for trigger diagnostics.
   * @returns {Promise<boolean>} True if the event was triggered successfully.
   */
  async press(log?: AnsiLogger): Promise<boolean> {
    return this.triggerSwitchEvent('Single', log);
  }
}
