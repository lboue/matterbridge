/**
 * @file packages/core/src/behaviors/timeSynchronizationServer.ts
 * @description This file contains the MatterbridgeTimeSynchronizationServer class of Matterbridge.
 * @author Ludovic BOUÉ
 * @created 2026-07-14
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

import { Seconds, Time, type Timer } from '@matter/general';
import { TimeSynchronizationServer } from '@matter/node/behaviors/time-synchronization';
import { TimeSynchronization } from '@matter/types/clusters/time-synchronization';
import { AnsiLogger, LogLevel, TimestampFormat } from 'node-ansi-logger';

const log = new AnsiLogger({ logName: 'TimeSynchronization', logTimestampFormat: TimestampFormat.TIME_MILLIS, logLevel: LogLevel.INFO });

/**
 * Time Synchronization server for the root endpoint that reports the host system clock.
 *
 * The node has no external time source (no NTP client/server, trusted time source, or time zone support), so it
 * always reports the current host system time with a Granularity of SecondsGranularity, and it accepts but ignores
 * the SetUtcTime command since the host system clock remains authoritative.
 */
export class MatterbridgeTimeSynchronizationServer extends TimeSynchronizationServer {
  #timer?: Timer;

  /**
   * Sets the initial UtcTime/Granularity from the host system clock, starts the periodic refresh timer and
   * delegates to the base behavior.
   */
  override initialize(): void {
    log.debug('Initializing MatterbridgeTimeSynchronizationServer');
    this.#updateUtcTime();
    // The reactor passed to callback()/reactTo() must be a real (non-arrow) function: matter.js rebinds `this` to the
    // active Behavior instance when invoking it, which an arrow function's lexical `this` would silently defeat.
    // oxlint-disable-next-line typescript/unbound-method
    this.#timer = Time.getPeriodicTimer('TimeSynchronization.utcTime', Seconds(1), this.callback(this.#updateUtcTime, { lock: true })).start();
    // Use `destroying`, not `destroyed`: behaviors (and their reactTo registrations) are torn down before
    // `destroyed` fires, so a reactor registered on `destroyed` would never run.
    // oxlint-disable-next-line typescript/unbound-method
    this.reactTo(this.endpoint.lifecycle.destroying, this.#stopTimer);
    super.initialize();
  }

  /**
   * Refreshes the UtcTime attribute from the host system clock and keeps Granularity consistent with it.
   */
  #updateUtcTime(): void {
    this.state.utcTime = Date.now() * 1000;
    this.state.granularity = TimeSynchronization.Granularity.SecondsGranularity;
  }

  /**
   * Stops the periodic UtcTime refresh timer.
   */
  #stopTimer(): void {
    this.#timer?.stop();
  }

  /**
   * Accepts the SetUtcTime command without changing the reported time, since the host system clock is authoritative.
   *
   * @param {TimeSynchronization.SetUtcTimeRequest} request - SetUtcTime request payload.
   */
  override setUtcTime(request: TimeSynchronization.SetUtcTimeRequest): void {
    log.info(`Ignoring SetUtcTime command (utcTime ${request.utcTime}, granularity ${request.granularity}): the root node uses the host system clock as time source`);
  }
}
