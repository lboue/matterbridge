/**
 * @file packages/core/vitest/devices/doorbell.test.ts
 * @description This file contains the tests for the Doorbell device.
 * @author Ludovic BOUÉ
 */

const NAME = 'Doorbell';
const MATTER_PORT = 8025;
const MATTER_CREATE_ONLY = true;

import { DescriptorServer } from '@matter/node/behaviors/descriptor';
import { Chime } from '@matter/types/clusters/chime';
import { Identify } from '@matter/types/clusters/identify';
import { PowerSource } from '@matter/types/clusters/power-source';
import { Switch } from '@matter/types/clusters/switch';
import { loggerErrorSpy, loggerFatalSpy, loggerLogSpy, loggerWarnSpy, setupTest } from '@matterbridge/vitest-utils';
import {
  addDevice,
  aggregator,
  createServerNode,
  createTestEnvironment,
  destroyTestEnvironment,
  flushServerNode,
  server,
  startServerNode,
  stopServerNode,
} from '@matterbridge/vitest-utils/matter';
import { LogLevel } from 'node-ansi-logger';

import { Doorbell } from '../../src/devices/doorbell.js';
import { doorbell } from '../../src/matterbridgeDeviceTypes.js';

// Setup the test environment
await setupTest(NAME, false);

describe('Matterbridge ' + NAME, () => {
  let device: Doorbell;

  beforeAll(async () => {
    // Setup the Matter test environment
    await createTestEnvironment();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    expect(loggerWarnSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
    expect(loggerFatalSpy).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    // Destroy the Matter test environment
    await destroyTestEnvironment();
    // Restore all mocks
    vi.restoreAllMocks();
  });

  test('create the server node', async () => {
    await createServerNode(MATTER_PORT, doorbell.code);
    expect(server).toBeDefined();
    expect(aggregator).toBeDefined();
  });

  test('create a doorbell device', () => {
    device = new Doorbell('Doorbell Test Device', 'DB123456');
    expect(device).toBeDefined();
    expect(device.id).toBe('DoorbellTestDevice-DB123456');

    expect(device.hasClusterServer(Identify.id)).toBeTruthy();
    expect(device.hasClusterServer(Switch.id)).toBeTruthy();
    expect(device.hasClusterServer(PowerSource.id)).toBeTruthy();
  });

  test('create a doorbell device with battery power', () => {
    const batteryDevice = new Doorbell('Doorbell Battery Device', 'DB000000', { batteryPowered: true });
    expect(batteryDevice.getClusterServerOptions(PowerSource.id)).toMatchObject({
      batChargeLevel: 0,
      batPercentRemaining: null,
      batReplaceability: 0,
      batReplacementNeeded: false,
      batVoltage: null,
      description: 'Primary battery',
      endpointList: [],
      order: 0,
      status: 1,
    });
  });

  test('add a doorbell device', async () => {
    expect(await addDevice(server, device)).toBeTruthy();
    expect(device.stateOf(DescriptorServer).clientList).toContain(Chime.id);
    expect((device.getAttribute(Switch.id, 'featureMap') as Record<string, boolean>).momentarySwitch).toBe(true);
  });

  test('press triggers a single Switch event', async () => {
    expect(await device.press(device.log)).toBe(true);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, expect.stringContaining('Switch.SinglePress'));
  });

  test('start the server node', async () => {
    if (!MATTER_CREATE_ONLY) await startServerNode();
    expect(server).toBeDefined();
    expect(aggregator).toBeDefined();
  });

  test('stop the server node', async () => {
    expect(server).toBeDefined();
    expect(aggregator).toBeDefined();
    if (MATTER_CREATE_ONLY) await flushServerNode();
    else await stopServerNode();
  });
});
