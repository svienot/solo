// SPDX-License-Identifier: Apache-2.0

import {describe, it} from 'mocha';
import {expect} from 'chai';

import {InitCommand} from '../../../../src/commands/init.js';
import {type DependencyManager} from '../../../../src/core/dependency-managers/index.js';
import {type ChartManager} from '../../../../src/core/chart-manager.js';
import {type ConfigManager} from '../../../../src/core/config-manager.js';
import {type K8Factory} from '../../../../src/integration/kube/k8-factory.js';
import {K8Client} from '../../../../src/integration/kube/k8-client/k8-client.js';
import {type KeyManager} from '../../../../src/core/key-manager.js';
import {type LockManager} from '../../../../src/core/lock/lock-manager.js';
import {type RemoteConfigManager} from '../../../../src/core/config/remote/remote-config-manager.js';
import sinon from 'sinon';
import {BASE_TEST_DIR} from '../../../test-utility.js';
import {Duration} from '../../../../src/core/time/duration.js';
import {container} from 'tsyringe-neo';
import {InjectTokens} from '../../../../src/core/dependency-injection/inject-tokens.js';
import {DEFAULT_LOCAL_CONFIG_FILE} from '../../../../src/core/constants.js';
import {type HelmClient} from '../../../../src/integration/helm/helm-client.js';
import {SoloWinstonLogger} from '../../../../src/core/logging/solo-winston-logger.js';
import {type SoloLogger} from '../../../../src/core/logging/solo-logger.js';
import {LocalConfigRuntimeState} from '../../../../src/business/runtime-state/local-config-runtime-state.js';

const testLogger: SoloLogger = new SoloWinstonLogger('debug', true);
describe('InitCommand', () => {
  const depManager: DependencyManager = container.resolve(InjectTokens.DependencyManager);
  const helm: HelmClient = container.resolve(InjectTokens.Helm);
  const chartManager: ChartManager = container.resolve(InjectTokens.ChartManager);

  const configManager: ConfigManager = container.resolve(InjectTokens.ConfigManager);
  let k8Factory: K8Factory;
  let localConfig: LocalConfigRuntimeState;

  const keyManager: KeyManager = container.resolve(InjectTokens.KeyManager);

  let leaseManager: LockManager;
  let remoteConfigManager: RemoteConfigManager;

  let sandbox = sinon.createSandbox();
  let initCmd: InitCommand;

  before(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(K8Client.prototype, 'init').callsFake(() => this);
    k8Factory = container.resolve(InjectTokens.K8Factory);
    localConfig = new LocalConfigRuntimeState(BASE_TEST_DIR, DEFAULT_LOCAL_CONFIG_FILE);
    remoteConfigManager = container.resolve(InjectTokens.RemoteConfigManager);
    leaseManager = container.resolve(InjectTokens.LockManager);

    // @ts-ignore
    initCmd = new InitCommand({
      logger: testLogger,
      helm,
      k8Factory,
      chartManager,
      configManager,
      depManager,
      keyManager,
      leaseManager,
      localConfig,
      remoteConfigManager,
    });
  });

  after(() => {
    sandbox.restore();
  });

  describe('commands', () => {
    it('init execution should succeed', async () => {
      await expect(initCmd.init({})).to.eventually.equal(true);
    }).timeout(Duration.ofSeconds(60).toMillis());
  });

  describe('methods', () => {
    it('command definition should return a valid command def', () => {
      const commandDefinition = initCmd.getCommandDefinition();

      // @ts-ignore
      expect(commandDefinition.name).not.to.be.null;
      expect(commandDefinition.desc).not.to.be.null;
      expect(commandDefinition.handler).not.to.be.null;
    });
  });
});
