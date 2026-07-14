/**
 * @file packages/core/vitest/behaviors/timeSynchronizationServer.test.ts
 * @description This file contains the tests for timeSynchronizationServer.
 * @author Ludovic BOUÉ
 */

const NAME = 'TimeSynchronizationServer';
const MATTER_PORT = 11700;
const MATTER_CREATE_ONLY = true;

import { TimeSynchronization } from '@matter/types/clusters/time-synchronization';
import { wait } from '@matterbridge/utils/wait';
import { loggerInfoSpy, setupTest } from '@matterbridge/vitest-utils';
import {
  addDevice,
  aggregator,
  createServerNode,
  createTestEnvironment,
  deleteDevice,
  destroyTestEnvironment,
  flushServerNode,
  startServerNode,
  stopServerNode,
} from '@matterbridge/vitest-utils/matter';

import { MatterbridgeTimeSynchronizationServer } from '../../src/behaviors/timeSynchronizationServer.js';
import { onOffLight } from '../../src/matterbridgeDeviceTypes.js';
import { MatterbridgeEndpoint } from '../../src/matterbridgeEndpoint.js';

// Setup the test environment
await setupTest(NAME, false);

describe('MatterbridgeTimeSynchronizationServer', () => {
  let device: MatterbridgeEndpoint;

  beforeAll(async () => {
    // Setup the Matter test environment
    await createTestEnvironment();

    // Create the server node and aggregator
    await createServerNode(MATTER_PORT);

    // Start the server node if not in create-only mode
    if (!MATTER_CREATE_ONLY) await startServerNode();
  });

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Stop or flush the server node depending on the create-only mode
    if (MATTER_CREATE_ONLY) await flushServerNode();
    else await stopServerNode();

    // Destroy the Matter test environment
    await destroyTestEnvironment();
    // Restore all mocks
    vi.restoreAllMocks();
  });

  test('reports the host system clock as UtcTime/Granularity on initialize', async () => {
    const before = BigInt(Date.now()) * 1000n;
    device = new MatterbridgeEndpoint(onOffLight, { id: 'TimeSyncDevice' });
    device.behaviors.require(MatterbridgeTimeSynchronizationServer);
    device.createDefaultIdentifyClusterServer().createDefaultOnOffClusterServer(false).addRequiredClusterServers();
    expect(await addDevice(aggregator, device)).toBe(true);
    const after = BigInt(Date.now()) * 1000n;

    expect(device.behaviors.has(MatterbridgeTimeSynchronizationServer)).toBe(true);
    const utcTime = BigInt(device.getAttribute(TimeSynchronization, 'utcTime') ?? 0);
    expect(utcTime).toBeGreaterThanOrEqual(before);
    expect(utcTime).toBeLessThanOrEqual(after);
    expect(device.getAttribute(TimeSynchronization, 'granularity')).toBe(TimeSynchronization.Granularity.SecondsGranularity);
  });

  test('refreshes UtcTime periodically from the host system clock', async () => {
    const initial = BigInt(device.getAttribute(TimeSynchronization, 'utcTime') ?? 0);
    await wait(1100); // Wait for the 1s periodic refresh timer to tick at least once
    const refreshed = BigInt(device.getAttribute(TimeSynchronization, 'utcTime') ?? 0);
    expect(refreshed).toBeGreaterThan(initial);
  });

  test('ignores the SetUtcTime command and logs the reason', async () => {
    const before = BigInt(device.getAttribute(TimeSynchronization, 'utcTime') ?? 0);
    await device.invokeBehaviorCommand(TimeSynchronization, 'setUtcTime', { utcTime: 1, granularity: TimeSynchronization.Granularity.NoTimeGranularity });
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Ignoring SetUtcTime command'));
    // UtcTime must still reflect the host clock, not the value from the ignored command
    const after = BigInt(device.getAttribute(TimeSynchronization, 'utcTime') ?? 0);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test('stops the refresh timer when the endpoint is destroyed', async () => {
    expect(await deleteDevice(aggregator, device)).toBe(true);
  });
});
