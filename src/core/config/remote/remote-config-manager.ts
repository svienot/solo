// SPDX-License-Identifier: Apache-2.0

import * as constants from '../../constants.js';
import {SoloError} from '../../errors/solo-error.js';
import {RemoteConfigDataWrapper} from './remote-config-data-wrapper.js';
import {RemoteConfigMetadata} from './metadata.js';
import {Flags as flags} from '../../../commands/flags.js';
import * as yaml from 'yaml';
import {ComponentsDataWrapper} from './components-data-wrapper.js';
import {RemoteConfigValidator} from './remote-config-validator.js';
import {type K8Factory} from '../../../integration/kube/k8-factory.js';
import {
  type ClusterReference,
  type ClusterReferences,
  type Context,
  type DeploymentName,
  type NamespaceNameAsString,
  type Version,
  type Optional,
} from '../../../types/index.js';
import {type SoloLogger} from '../../logging/solo-logger.js';
import {type ConfigManager} from '../../config-manager.js';
import {inject, injectable} from 'tsyringe-neo';
import {patchInject} from '../../dependency-injection/container-helper.js';
import {ErrorMessages} from '../../error-messages.js';
import {CommonFlagsDataWrapper} from './common-flags-data-wrapper.js';
import {type AnyObject, type ArgvStruct, type NodeAlias, type NodeAliases} from '../../../types/aliases.js';
import {type NamespaceName} from '../../../types/namespace/namespace-name.js';
import {InjectTokens} from '../../dependency-injection/inject-tokens.js';
import {Cluster} from './cluster.js';
import {ConsensusNode} from '../../model/consensus-node.js';
import {Templates} from '../../templates.js';
import {promptTheUserForDeployment, resolveNamespaceFromDeployment} from '../../resolvers.js';
import {type ConfigMap} from '../../../integration/kube/resources/config-map/config-map.js';
import {getSoloVersion} from '../../../../version.js';
import {LocalConfigRuntimeState} from '../../../business/runtime-state/local-config-runtime-state.js';
import {DeploymentStates} from './enumerations/deployment-states.js';

/**
 * Uses Kubernetes ConfigMaps to manage the remote configuration data by creating, loading, modifying,
 * and saving the configuration data to and from a Kubernetes cluster.
 */
@injectable()
export class RemoteConfigManager {
  /** Stores the loaded remote configuration data. */
  private remoteConfig: Optional<RemoteConfigDataWrapper>;

  /**
   * @param k8Factory - The Kubernetes client used for interacting with ConfigMaps.
   * @param logger - The logger for recording activity and errors.
   * @param localConfig - Local configuration for the remote config.
   * @param configManager - Manager to retrieve application flags and settings.
   */
  public constructor(
    @inject(InjectTokens.K8Factory) private readonly k8Factory?: K8Factory,
    @inject(InjectTokens.SoloLogger) private readonly logger?: SoloLogger,
    @inject(InjectTokens.LocalConfigRuntimeState) private readonly localConfig?: LocalConfigRuntimeState,
    @inject(InjectTokens.ConfigManager) private readonly configManager?: ConfigManager,
  ) {
    this.k8Factory = patchInject(k8Factory, InjectTokens.K8Factory, this.constructor.name);
    this.logger = patchInject(logger, InjectTokens.SoloLogger, this.constructor.name);
    this.localConfig = patchInject(localConfig, InjectTokens.LocalConfigRuntimeState, this.constructor.name);
    this.configManager = patchInject(configManager, InjectTokens.ConfigManager, this.constructor.name);
  }

  /* ---------- Getters ---------- */

  public get currentCluster(): ClusterReference {
    return this.k8Factory.default().clusters().readCurrent();
  }

  /** @returns the components data wrapper cloned */
  public get components(): ComponentsDataWrapper {
    return this.remoteConfig.components.clone();
  }

  /**
   * @returns the remote configuration data's clusters cloned
   */
  public get clusters(): Record<ClusterReference, Cluster> {
    return structuredClone(this.remoteConfig.clusters);
  }

  /* ---------- Readers and Modifiers ---------- */

  /**
   * Modifies the loaded remote configuration data using a provided callback function.
   * The callback operates on the configuration data, which is then saved to the cluster.
   *
   * @param callback - an async function that modifies the remote configuration data.
   * @throws if the configuration is not loaded before modification, will throw a SoloError {@link SoloError}
   */
  public async modify(callback: (remoteConfig: RemoteConfigDataWrapper) => Promise<void>): Promise<void> {
    if (!this.remoteConfig) {
      throw new SoloError('Attempting to modify remote config without loading it first');
    }

    // Call the callback function to modify the remote config
    await callback(this.remoteConfig);

    // Save the modified version of the remote config
    await this.save();
  }

  /**
   * Creates a new remote configuration in the Kubernetes cluster.
   * Gathers data from the local configuration and constructs a new ConfigMap
   * entry in the cluster with initial command history and metadata.
   */
  public async create(
    argv: ArgvStruct,
    state: DeploymentStates,
    nodeAliases: NodeAliases,
    namespace: NamespaceName,
    deployment: DeploymentName,
    clusterReference: ClusterReference,
    context: Context,
    dnsBaseDomain: string,
    dnsConsensusNodePattern: string,
  ): Promise<void> {
    const clusters: Record<ClusterReference, Cluster> = {
      [clusterReference]: new Cluster(
        clusterReference,
        namespace.name,
        deployment,
        dnsBaseDomain,
        dnsConsensusNodePattern,
      ),
    };

    const lastUpdatedAt = new Date();
    const userIdentity = this.localConfig.userIdentity;
    const soloVersion = getSoloVersion();
    const currentCommand = argv._.join(' ');

    this.remoteConfig = new RemoteConfigDataWrapper({
      clusters,
      metadata: new RemoteConfigMetadata(namespace.name, deployment, state, lastUpdatedAt, userIdentity, soloVersion),
      commandHistory: [currentCommand],
      lastExecutedCommand: currentCommand,
      components: ComponentsDataWrapper.initializeWithNodes(nodeAliases, clusterReference, namespace.name),
      flags: await CommonFlagsDataWrapper.initialize(this.configManager, argv),
    });

    await this.createConfigMap(context);
  }

  /**
   * Saves the currently loaded remote configuration data to the Kubernetes cluster.
   * @throws {@link SoloError} if there is no remote configuration data to save.
   */
  private async save(): Promise<void> {
    if (!this.remoteConfig) {
      throw new SoloError('Attempted to save remote config without data');
    }

    await this.replaceConfigMap();
  }

  /**
   * Loads the remote configuration from the Kubernetes cluster if it exists.
   * @param namespace - The namespace to search for the ConfigMap.
   * @param context - The context to use for the Kubernetes client.
   * @returns true if the configuration is loaded successfully.
   */
  private async load(namespace?: NamespaceName, context?: Context): Promise<void> {
    if (this.remoteConfig) {
      return;
    }
    try {
      const configMap = await this.getConfigMap(namespace, context);

      this.remoteConfig = RemoteConfigDataWrapper.fromConfigmap(this.configManager, configMap);
    } catch (error) {
      throw new SoloError('Failed to load remote config from cluster', error);
    }
  }

  /**
   * Loads the remote configuration, performs a validation and returns it
   * @returns RemoteConfigDataWrapper
   */
  public async get(context?: Context): Promise<RemoteConfigDataWrapper> {
    const namespace = this.configManager.getFlag<NamespaceName>(flags.namespace) ?? (await this.getNamespace());

    await this.load(namespace, context);
    try {
      await RemoteConfigValidator.validateComponents(
        namespace,
        this.remoteConfig.components,
        this.k8Factory,
        this.localConfig,
        false,
      );
    } catch (error) {
      throw new SoloError(
        ErrorMessages.REMOTE_CONFIG_IS_INVALID(this.k8Factory.getK8(context).clusters().readCurrent()),
        error,
      );
    }
    return this.remoteConfig;
  }

  /** Unload the remote config from the remote config manager. */
  public unload(): void {
    this.remoteConfig = undefined;
  }

  public static compare(remoteConfig1: RemoteConfigDataWrapper, remoteConfig2: RemoteConfigDataWrapper): boolean {
    // Compare clusters
    const clusters1 = Object.keys(remoteConfig1.clusters);
    const clusters2 = Object.keys(remoteConfig2.clusters);
    if (clusters1.length !== clusters2.length) {
      return false;
    }

    for (const index in clusters1) {
      if (clusters1[index] !== clusters2[index]) {
        return false;
      }
    }

    return true;
  }

  /* ---------- Listr Task Builders ---------- */

  /**
   * Performs the loading of the remote configuration.
   * Checks if the configuration is already loaded, otherwise loads and adds the command to history.
   *
   * @param argv - arguments containing command input for historical reference.
   * @param validate - whether to validate the remote configuration.
   * @param [skipConsensusNodesValidation] - whether or not to validate the consensusNodes
   */
  public async loadAndValidate(
    argv: {_: string[]} & AnyObject,
    validate: boolean = true,
    skipConsensusNodesValidation: boolean = true,
  ): Promise<void> {
    await this.setDefaultNamespaceAndDeploymentIfNotSet(argv);
    this.setDefaultContextIfNotSet();

    await this.load();

    this.logger.info('Remote config loaded');
    if (!validate) {
      return;
    }

    await RemoteConfigValidator.validateComponents(
      this.configManager.getFlag(flags.namespace),
      this.remoteConfig.components,
      this.k8Factory,
      this.localConfig,
      skipConsensusNodesValidation,
    );

    const currentCommand = argv._?.join(' ');
    const commandArguments = flags.stringifyArgv(argv);

    this.remoteConfig!.addCommandToHistory(
      `Executed by ${this.localConfig.userIdentity.name}: ${currentCommand} ${commandArguments}`.trim(),
    );

    this.populateVersionsInMetadata(argv);

    await this.remoteConfig.flags.handleFlags(argv);

    await this.save();
  }

  private populateVersionsInMetadata(argv: AnyObject): void {
    const command: string = argv._[0];
    const subcommand: string = argv._[1];

    const isCommandUsingSoloChartVersionFlag =
      (command === 'network' && subcommand === 'deploy') ||
      (command === 'network' && subcommand === 'refresh') ||
      (command === 'node' && subcommand === 'update') ||
      (command === 'node' && subcommand === 'update-execute') ||
      (command === 'node' && subcommand === 'add') ||
      (command === 'node' && subcommand === 'add-execute') ||
      (command === 'node' && subcommand === 'delete') ||
      (command === 'node' && subcommand === 'delete-execute');

    if (argv[flags.soloChartVersion.name]) {
      this.remoteConfig.metadata.soloChartVersion = argv[flags.soloChartVersion.name] as Version;
    } else if (isCommandUsingSoloChartVersionFlag) {
      this.remoteConfig.metadata.soloChartVersion = flags.soloChartVersion.definition.defaultValue as Version;
    }

    const isCommandUsingReleaseTagVersionFlag =
      (command === 'node' && subcommand !== 'keys' && subcommand !== 'logs' && subcommand !== 'states') ||
      (command === 'network' && subcommand === 'deploy');

    if (argv[flags.releaseTag.name]) {
      this.remoteConfig.metadata.hederaPlatformVersion = argv[flags.releaseTag.name] as Version;
    } else if (isCommandUsingReleaseTagVersionFlag) {
      this.remoteConfig.metadata.hederaPlatformVersion = flags.releaseTag.definition.defaultValue as Version;
    }

    if (argv[flags.mirrorNodeVersion.name]) {
      this.remoteConfig.metadata.hederaMirrorNodeChartVersion = argv[flags.mirrorNodeVersion.name] as Version;
    } else if (command === 'mirror-node' && subcommand === 'deploy') {
      this.remoteConfig.metadata.hederaMirrorNodeChartVersion = flags.mirrorNodeVersion.definition
        .defaultValue as Version;
    }

    if (argv[flags.hederaExplorerVersion.name]) {
      this.remoteConfig.metadata.hederaExplorerChartVersion = argv[flags.hederaExplorerVersion.name] as Version;
    } else if (command === 'explorer' && subcommand === 'deploy') {
      this.remoteConfig.metadata.hederaExplorerChartVersion = flags.hederaExplorerVersion.definition
        .defaultValue as Version;
    }

    if (argv[flags.relayReleaseTag.name]) {
      this.remoteConfig.metadata.hederaJsonRpcRelayChartVersion = argv[flags.relayReleaseTag.name] as Version;
    } else if (command === 'relay' && subcommand === 'deploy') {
      this.remoteConfig.metadata.hederaJsonRpcRelayChartVersion = flags.relayReleaseTag.definition
        .defaultValue as Version;
    }
  }

  /* ---------- Utilities ---------- */

  /** Empties the component data inside the remote config */
  public async deleteComponents(): Promise<void> {
    await this.modify(async remoteConfig => {
      remoteConfig.components = ComponentsDataWrapper.initializeEmpty();
    });
  }

  public isLoaded(): boolean {
    return !!this.remoteConfig;
  }

  /**
   * Retrieves the ConfigMap containing the remote configuration from the Kubernetes cluster.
   *
   * @param namespace - The namespace to search for the ConfigMap.
   * @param context - The context to use for the Kubernetes client.
   * @returns the remote configuration data.
   * @throws if the ConfigMap could not be read and the error is not a 404 status, will throw a SoloError {@link SoloError}
   */
  public async getConfigMap(namespace?: NamespaceName, context?: Context): Promise<ConfigMap> {
    if (!namespace) {
      namespace = await this.getNamespace();
    }
    if (!context) {
      context = this.configManager.getFlag(flags.context) ?? this.getContextForFirstCluster();
    }

    try {
      const configMap = await this.k8Factory
        .getK8(context)
        .configMaps()
        .read(namespace, constants.SOLO_REMOTE_CONFIGMAP_NAME);

      if (!configMap) {
        throw new SoloError(`Remote config ConfigMap not found for namespace: ${namespace}, context: ${context}`);
      }

      return configMap;
    } catch (error) {
      throw new SoloError(
        `Failed to read remote config from cluster for namespace: ${namespace}, context: ${context}`,
        error,
      );
    }
  }

  /**
   * Creates a new ConfigMap entry in the Kubernetes cluster with the remote configuration data.
   */
  public async createConfigMap(context?: Context): Promise<void> {
    const namespace = await this.getNamespace();
    const name = constants.SOLO_REMOTE_CONFIGMAP_NAME;
    const labels = constants.SOLO_REMOTE_CONFIGMAP_LABELS;
    const data = {'remote-config-data': yaml.stringify(this.remoteConfig.toObject())};

    await this.k8Factory.getK8(context).configMaps().create(namespace, name, labels, data);
  }

  /**
   * Replaces an existing ConfigMap in the Kubernetes cluster with the current remote configuration data.
   */
  private async replaceConfigMap(): Promise<void> {
    const namespace = await this.getNamespace();
    const name = constants.SOLO_REMOTE_CONFIGMAP_NAME;
    const labels = constants.SOLO_REMOTE_CONFIGMAP_LABELS;
    const data = {'remote-config-data': yaml.stringify(this.remoteConfig.toObject())};

    const deploymentName = this.configManager.getFlag<DeploymentName>(flags.deployment);

    if (!deploymentName) {
      throw new SoloError('Failed to get deployment');
    }

    const clusterReferences: ClusterReference[] = this.localConfig.getDeployment(deploymentName).clusters;

    if (!clusterReferences) {
      throw new SoloError(`Failed to get get cluster refs from local config for deployment ${deploymentName}`);
    }

    const contexts: Context[] = clusterReferences.map((clusterReference): string =>
      this.localConfig.clusterRefs.get(clusterReference),
    );

    await Promise.all(
      contexts.map(context => this.k8Factory.getK8(context).configMaps().replace(namespace, name, labels, data)),
    );
  }

  private async setDefaultNamespaceAndDeploymentIfNotSet(argv: AnyObject): Promise<void> {
    if (this.configManager.hasFlag(flags.namespace)) {
      return;
    }

    // TODO: Current quick fix for commands where namespace is not passed
    let deploymentName = this.configManager.getFlag<DeploymentName>(flags.deployment);
    let currentDeployment = this.localConfig.getDeployment(deploymentName);

    if (!deploymentName) {
      deploymentName = await promptTheUserForDeployment(this.configManager);
      currentDeployment = this.localConfig.getDeployment(deploymentName);
      // TODO: Fix once we have the DataManager,
      //       without this the user will be prompted a second time for the deployment
      // TODO: we should not be mutating argv
      argv[flags.deployment.name] = deploymentName;
      this.logger.warn(
        `Deployment name not found in flags or local config, setting it in argv and config manager to: ${deploymentName}`,
      );
      this.configManager.setFlag(flags.deployment, deploymentName);
    }

    if (!currentDeployment) {
      throw new SoloError(`Selected deployment name is not set in local config - ${deploymentName}`);
    }

    const namespace: NamespaceNameAsString = currentDeployment.namespace;

    this.logger.warn(`Namespace not found in flags, setting it to: ${namespace}`);
    this.configManager.setFlag(flags.namespace, namespace);
    argv[flags.namespace.name] = namespace;
  }

  private setDefaultContextIfNotSet(): void {
    if (this.configManager.hasFlag(flags.context)) {
      return;
    }

    const context: Context = this.getContextForFirstCluster() ?? this.k8Factory.default().contexts().readCurrent();

    if (!context) {
      throw new SoloError("Context is not passed and default one can't be acquired");
    }

    this.logger.warn(`Context not found in flags, setting it to: ${context}`);
    this.configManager.setFlag(flags.context, context);
  }

  /**
   * Retrieves the namespace value from the configuration manager's flags.
   * @returns string - The namespace value if set.
   */
  private async getNamespace(): Promise<NamespaceName> {
    return await resolveNamespaceFromDeployment(this.localConfig, this.configManager);
  }

  //* Common Commands

  /**
   * Get the consensus nodes from the remoteConfigManager and use the localConfig to get the context
   * @returns an array of ConsensusNode objects
   */
  public getConsensusNodes(): ConsensusNode[] {
    if (!this.isLoaded()) {
      throw new SoloError('Remote configuration is not loaded, and was expected to be loaded');
    }

    const consensusNodes: ConsensusNode[] = [];

    for (const node of Object.values(this.components.consensusNodes)) {
      const cluster: Cluster = this.clusters[node.cluster];
      const context: Context = this.localConfig.clusterRefs.get(node.cluster);

      consensusNodes.push(
        new ConsensusNode(
          node.name as NodeAlias,
          node.nodeId,
          node.namespace,
          node.cluster,
          context,
          cluster.dnsBaseDomain,
          cluster.dnsConsensusNodePattern,
          Templates.renderConsensusNodeFullyQualifiedDomainName(
            node.name as NodeAlias,
            node.nodeId,
            node.namespace,
            node.cluster,
            cluster.dnsBaseDomain,
            cluster.dnsConsensusNodePattern,
          ),
        ),
      );
    }

    // return the consensus nodes
    return consensusNodes;
  }

  /**
   * Gets a list of distinct contexts from the consensus nodes.
   * @returns an array of context strings.
   */
  public getContexts(): Context[] {
    return [...new Set(this.getConsensusNodes().map((node): Context => node.context))];
  }

  /**
   * Gets a list of distinct cluster references from the consensus nodes.
   * @returns an object of cluster references.
   */
  public getClusterRefs(): ClusterReferences {
    const nodes = this.getConsensusNodes();
    const accumulator: ClusterReferences = new Map<string, string>();

    for (const node of nodes) {
      accumulator.set(node.cluster, node.context);
    }

    return accumulator;
  }

  private getContextForFirstCluster(): string {
    const deploymentName = this.configManager.getFlag<DeploymentName>(flags.deployment);

    const clusterReference: ClusterReference = this.localConfig.getDeployment(deploymentName).clusters[0];

    const context: Context = this.localConfig.clusterRefs.get(clusterReference);

    this.logger.debug(`Using context ${context} for cluster ${clusterReference} for deployment ${deploymentName}`);

    return context;
  }
}
