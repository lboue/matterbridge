/**
 * @file packages/core/src/behaviors/thermostatServer.ts
 * @description This file contains the MatterbridgeThermostatServer and MatterbridgePresetThermostatServer classes of Matterbridge.
 * @author Luca Liguori
 * @created 2026-03-28
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

/* oxlint-disable typescript/no-unsafe-type-assertion */

import { Bytes } from '@matter/general';
import { ThermostatServer } from '@matter/node/behaviors/thermostat';
import { StatusResponse } from '@matter/types';
import { Thermostat } from '@matter/types/clusters/thermostat';

import type { MatterbridgeEndpoint } from '../matterbridgeEndpoint.js';
import type { ClusterAttributeValues } from '../matterbridgeEndpointCommandHandler.js';
import { MatterbridgeServer } from './matterbridgeServer.js';

/**
 * Thermostat server (cooling/heating/auto/occupancy/presets/schedules/suggestions/events) with Matterbridge-specific command handling.
 */
export class MatterbridgeThermostatServer extends ThermostatServer.with(
  Thermostat.Feature.Cooling,
  Thermostat.Feature.Heating,
  Thermostat.Feature.AutoMode,
  Thermostat.Feature.Occupancy,
  Thermostat.Feature.Presets,
  Thermostat.Feature.MatterScheduleConfiguration,
  Thermostat.Feature.ThermostatSuggestions,
  Thermostat.Feature.Events,
) {
  /**
   * When the Events (TEVT) feature is enabled, sets up reactors that emit the eight Thermostat cluster events
   * defined by Matter 1.6 § 4.3.13 whenever their source attribute changes.
   *
   * @remarks
   * matter.js does not yet generate these events itself (the Events feature is not implemented by `ThermostatServer`
   * in `@matter/node`), so Matterbridge reacts to the relevant attribute-changed observables and emits them here.
   * `maybeReactTo` is used for every source attribute that is not unconditionally present regardless of feature
   * combination (SystemMode is the only one that always is), since the corresponding `$Changed` observable only
   * exists on endpoints where the attribute itself is actually present.
   */
  override async initialize(): Promise<void> {
    await super.initialize();
    if (!this.features.events) return;

    this.reactTo(this.events.systemMode$Changed, this.#emitSystemModeChange);
    this.maybeReactTo(this.events.thermostatRunningState$Changed, this.#emitRunningStateChange);
    this.maybeReactTo(this.events.occupiedHeatingSetpoint$Changed, this.#emitOccupiedHeatingSetpointChange);
    this.maybeReactTo(this.events.unoccupiedHeatingSetpoint$Changed, this.#emitUnoccupiedHeatingSetpointChange);
    this.maybeReactTo(this.events.occupiedCoolingSetpoint$Changed, this.#emitOccupiedCoolingSetpointChange);
    this.maybeReactTo(this.events.unoccupiedCoolingSetpoint$Changed, this.#emitUnoccupiedCoolingSetpointChange);
    this.maybeReactTo(this.events.occupancy$Changed, this.#emitOccupancyChange);
    this.maybeReactTo(this.events.thermostatRunningMode$Changed, this.#emitRunningModeChange);
    this.maybeReactTo(this.events.activeScheduleHandle$Changed, this.#emitActiveScheduleChange);
    this.maybeReactTo(this.events.activePresetHandle$Changed, this.#emitActivePresetChange);
    if (!this.features.localTemperatureNotExposed) {
      this.reactTo(this.events.calibratedTemperature$Changed, this.#emitLocalTemperatureChange);
    }
  }

  #emitSystemModeChange = (currentSystemMode: Thermostat.SystemMode, previousSystemMode: Thermostat.SystemMode): void => {
    this.events.systemModeChange.emit({ previousSystemMode, currentSystemMode }, this.context);
  };

  #emitRunningStateChange = (currentRunningState: Thermostat.RelayState, previousRunningState: Thermostat.RelayState): void => {
    this.events.runningStateChange.emit({ previousRunningState, currentRunningState }, this.context);
  };

  #emitOccupiedHeatingSetpointChange = (currentSetpoint: number, previousSetpoint: number): void => {
    this.events.setpointChange.emit({ systemMode: Thermostat.SystemMode.Heat, occupancy: { occupied: true }, previousSetpoint, currentSetpoint }, this.context);
  };

  #emitUnoccupiedHeatingSetpointChange = (currentSetpoint: number, previousSetpoint: number): void => {
    this.events.setpointChange.emit({ systemMode: Thermostat.SystemMode.Heat, occupancy: { occupied: false }, previousSetpoint, currentSetpoint }, this.context);
  };

  #emitOccupiedCoolingSetpointChange = (currentSetpoint: number, previousSetpoint: number): void => {
    this.events.setpointChange.emit({ systemMode: Thermostat.SystemMode.Cool, occupancy: { occupied: true }, previousSetpoint, currentSetpoint }, this.context);
  };

  #emitUnoccupiedCoolingSetpointChange = (currentSetpoint: number, previousSetpoint: number): void => {
    this.events.setpointChange.emit({ systemMode: Thermostat.SystemMode.Cool, occupancy: { occupied: false }, previousSetpoint, currentSetpoint }, this.context);
  };

  #emitOccupancyChange = (currentOccupancy: Thermostat.Occupancy, previousOccupancy: Thermostat.Occupancy): void => {
    this.events.occupancyChange.emit({ previousOccupancy, currentOccupancy }, this.context);
  };

  #emitRunningModeChange = (currentRunningMode: Thermostat.ThermostatRunningMode, previousRunningMode: Thermostat.ThermostatRunningMode): void => {
    this.events.runningModeChange.emit({ previousRunningMode, currentRunningMode }, this.context);
  };

  #emitActiveScheduleChange = (currentScheduleHandle: Uint8Array | null, previousScheduleHandle: Uint8Array | null): void => {
    this.events.activeScheduleChange.emit({ previousScheduleHandle, currentScheduleHandle }, this.context);
  };

  #emitActivePresetChange = (currentPresetHandle: Uint8Array | null, previousPresetHandle: Uint8Array | null): void => {
    this.events.activePresetChange.emit({ previousPresetHandle, currentPresetHandle }, this.context);
  };

  /** Timestamp (ms since epoch) of the last emitted LocalTemperatureChange event, to enforce the spec's 60 s minimum interval. */
  #lastLocalTemperatureChangeEmittedAt = 0;

  /**
   * Emits LocalTemperatureChange, throttled to at most once every 60 seconds as required by Matter 1.6 § 4.3.13.2.
   *
   * @param {number | null} currentLocalTemperature - The calibrated local temperature after the change.
   * @param {number | null} previousLocalTemperature - The calibrated local temperature before the change.
   */
  #emitLocalTemperatureChange = (currentLocalTemperature: number | null, previousLocalTemperature: number | null): void => {
    if (currentLocalTemperature === previousLocalTemperature) return;
    const now = Date.now();
    if (now - this.#lastLocalTemperatureChangeEmittedAt < 60_000) return;
    this.#lastLocalTemperatureChangeEmittedAt = now;
    this.events.localTemperatureChange.emit({ currentLocalTemperature }, this.context);
  };

  /**
   * Forwards SetpointRaiseLower requests to the Matterbridge command handler and updates occupied setpoints.
   *
   * @param {Thermostat.SetpointRaiseLowerRequest} request - Setpoint-raise/lower request payload.
   */
  override async setpointRaiseLower(request: Thermostat.SetpointRaiseLowerRequest): Promise<void> {
    const device = this.endpoint.stateOf(MatterbridgeServer);
    device.log.info(`Setting setpoint by ${request.amount} in mode ${request.mode} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
    await device.commandHandler.executeHandler('Thermostat.setpointRaiseLower', {
      command: 'setpointRaiseLower',
      request,
      cluster: ThermostatServer.id,
      attributes: this.state as unknown as ClusterAttributeValues<(typeof Thermostat)['attributes']>,
      endpoint: this.endpoint as MatterbridgeEndpoint,
      context: this.context,
    });
    const lookupSetpointAdjustMode = ['Heat', 'Cool', 'Both'];
    device.log.debug(`MatterbridgeThermostatServer: setpointRaiseLower called with mode: ${lookupSetpointAdjustMode[request.mode]} amount: ${request.amount / 10}`);
    await super.setpointRaiseLower(request);
  }

  /**
   * Forwards SetActivePresetRequest requests to the Matterbridge command handler.
   *
   * @param {Thermostat.SetActivePresetRequest} request - Set-active-preset request payload.
   */
  override async setActivePresetRequest(request: Thermostat.SetActivePresetRequest): Promise<void> {
    const device = this.endpoint.stateOf(MatterbridgeServer);
    const presetHandle = request.presetHandle ? `0x${Buffer.from(request.presetHandle).toString('hex')}` : 'null';
    device.log.info(`Setting preset to ${presetHandle} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
    await device.commandHandler.executeHandler('Thermostat.setActivePresetRequest', {
      command: 'setActivePresetRequest',
      request,
      cluster: ThermostatServer.id,
      attributes: this.state as unknown as ClusterAttributeValues<(typeof Thermostat)['attributes']>,
      endpoint: this.endpoint as MatterbridgeEndpoint,
      context: this.context,
    });
    device.log.debug(`MatterbridgeThermostatServer: setActivePresetRequest called with presetHandle: ${presetHandle}`);
    await super.setActivePresetRequest(request);
    const activePresetHandle = this.state.activePresetHandle ? `0x${Buffer.from(this.state.activePresetHandle).toString('hex')}` : 'null';
    device.log.debug(
      `MatterbridgeThermostatServer: setActivePresetRequest completed with activePresetHandle: ${activePresetHandle} occupiedHeatingSetpoint: ${this.state.occupiedHeatingSetpoint} occupiedCoolingSetpoint: ${this.state.occupiedCoolingSetpoint}`,
    );
  }

  /**
   * Forwards SetActiveScheduleRequest requests to the Matterbridge command handler and updates the active schedule handle.
   *
   * @param {Thermostat.SetActiveScheduleRequest} request - Set-active-schedule request payload.
   *
   * @remarks
   * matter.js does not yet provide a default implementation of this command (the MatterScheduleConfiguration feature
   * is not implemented by `ThermostatServer` in `@matter/node`), so validation and state handling are done here.
   */
  override async setActiveScheduleRequest(request: Thermostat.SetActiveScheduleRequest): Promise<void> {
    const device = this.endpoint.stateOf(MatterbridgeServer);
    const scheduleHandle = `0x${Buffer.from(request.scheduleHandle).toString('hex')}`;
    device.log.info(`Setting schedule to ${scheduleHandle} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
    await device.commandHandler.executeHandler('Thermostat.setActiveScheduleRequest', {
      command: 'setActiveScheduleRequest',
      request,
      cluster: ThermostatServer.id,
      attributes: this.state as unknown as ClusterAttributeValues<(typeof Thermostat)['attributes']>,
      endpoint: this.endpoint as MatterbridgeEndpoint,
      context: this.context,
    });
    const schedule = this.state.schedules.find((s) => s.scheduleHandle !== null && Bytes.areEqual(s.scheduleHandle, request.scheduleHandle));
    if (schedule === undefined) {
      throw new StatusResponse.InvalidCommandError('Requested ScheduleHandle not found');
    }
    this.state.activeScheduleHandle = Uint8Array.from(request.scheduleHandle);
    device.log.debug(`MatterbridgeThermostatServer: setActiveScheduleRequest completed with activeScheduleHandle: ${scheduleHandle}`);
  }

  /**
   * Forwards AddThermostatSuggestion requests to the Matterbridge command handler and appends the new suggestion.
   *
   * @param {Thermostat.AddThermostatSuggestionRequest} request - Add-thermostat-suggestion request payload.
   * @returns {Promise<Thermostat.AddThermostatSuggestionResponse>} The generated UniqueID of the added suggestion.
   *
   * @remarks
   * matter.js does not yet provide a default implementation of this command (the ThermostatSuggestions feature
   * is not implemented by `ThermostatServer` in `@matter/node`), so validation and list bookkeeping are done here.
   */
  override async addThermostatSuggestion(request: Thermostat.AddThermostatSuggestionRequest): Promise<Thermostat.AddThermostatSuggestionResponse> {
    const device = this.endpoint.stateOf(MatterbridgeServer);
    const presetHandle = `0x${Buffer.from(request.presetHandle).toString('hex')}`;
    device.log.info(`Adding thermostat suggestion for preset ${presetHandle} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
    await device.commandHandler.executeHandler('Thermostat.addThermostatSuggestion', {
      command: 'addThermostatSuggestion',
      request,
      cluster: ThermostatServer.id,
      attributes: this.state as unknown as ClusterAttributeValues<(typeof Thermostat)['attributes']>,
      endpoint: this.endpoint as MatterbridgeEndpoint,
      context: this.context,
    });
    if (this.state.presets.find((p) => p.presetHandle !== null && Bytes.areEqual(p.presetHandle, request.presetHandle)) === undefined) {
      throw new StatusResponse.NotFoundError('Requested PresetHandle not found');
    }
    if (this.state.thermostatSuggestions.length >= this.state.maxThermostatSuggestions) {
      throw new StatusResponse.ResourceExhaustedError('Maximum number of thermostat suggestions reached');
    }
    const currentTime = Math.floor(Date.now() / 1000);
    const effectiveTime = request.effectiveTime ?? currentTime;
    if (effectiveTime > currentTime + 24 * 60 * 60) {
      throw new StatusResponse.InvalidCommandError('EffectiveTime cannot be more than 24 hours in the future');
    }
    const usedUniqueIds = new Set(this.state.thermostatSuggestions.map((s) => s.uniqueId));
    let uniqueId = 0;
    while (usedUniqueIds.has(uniqueId)) uniqueId++;
    const suggestion: Thermostat.ThermostatSuggestion = {
      uniqueId,
      presetHandle: Uint8Array.from(request.presetHandle),
      effectiveTime,
      expirationTime: effectiveTime + request.expirationInMinutes * 60,
    };
    this.state.thermostatSuggestions = [...this.state.thermostatSuggestions, suggestion];
    device.log.debug(`MatterbridgeThermostatServer: addThermostatSuggestion completed with uniqueId: ${uniqueId}`);
    return { uniqueId };
  }

  /**
   * Forwards RemoveThermostatSuggestion requests to the Matterbridge command handler and removes the suggestion.
   *
   * @param {Thermostat.RemoveThermostatSuggestionRequest} request - Remove-thermostat-suggestion request payload.
   *
   * @remarks
   * matter.js does not yet provide a default implementation of this command (the ThermostatSuggestions feature
   * is not implemented by `ThermostatServer` in `@matter/node`), so validation and list bookkeeping are done here.
   */
  override async removeThermostatSuggestion(request: Thermostat.RemoveThermostatSuggestionRequest): Promise<void> {
    const device = this.endpoint.stateOf(MatterbridgeServer);
    device.log.info(`Removing thermostat suggestion ${request.uniqueId} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
    await device.commandHandler.executeHandler('Thermostat.removeThermostatSuggestion', {
      command: 'removeThermostatSuggestion',
      request,
      cluster: ThermostatServer.id,
      attributes: this.state as unknown as ClusterAttributeValues<(typeof Thermostat)['attributes']>,
      endpoint: this.endpoint as MatterbridgeEndpoint,
      context: this.context,
    });
    const suggestion = this.state.thermostatSuggestions.find((s) => s.uniqueId === request.uniqueId);
    if (suggestion === undefined) {
      throw new StatusResponse.NotFoundError('Requested UniqueID not found');
    }
    this.state.thermostatSuggestions = this.state.thermostatSuggestions.filter((s) => s.uniqueId !== request.uniqueId);
    if (this.state.currentThermostatSuggestion?.uniqueId === request.uniqueId) {
      this.state.currentThermostatSuggestion = null;
      this.state.thermostatSuggestionNotFollowingReason = null;
    }
    device.log.debug(`MatterbridgeThermostatServer: removeThermostatSuggestion completed for uniqueId: ${request.uniqueId}`);
  }
}
