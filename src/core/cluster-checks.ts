// SPDX-License-Identifier: Apache-2.0

import {type NamespaceName} from '../types/namespace/namespace-name.js';
import * as constants from './constants.js';
import {patchInject} from './dependency-injection/container-helper.js';
import {type SoloLogger} from './logging/solo-logger.js';
import {inject, injectable} from 'tsyringe-neo';
import {type K8Factory} from '../integration/kube/k8-factory.js';
import {type Pod} from '../integration/kube/resources/pod/pod.js';
import {type IngressClass} from '../integration/kube/resources/ingress-class/ingress-class.js';
import {InjectTokens} from './dependency-injection/inject-tokens.js';
import {type ConfigMap} from '../integration/kube/resources/config-map/config-map.js';

/**
 * Class to check if certain components are installed in the cluster.
 */
@injectable()
export class ClusterChecks {
  constructor(
    @inject(InjectTokens.SoloLogger) private readonly logger?: SoloLogger,
    @inject(InjectTokens.K8Factory) private readonly k8Factory?: K8Factory,
  ) {
    this.logger = patchInject(logger, InjectTokens.SoloLogger, this.constructor.name);
    this.k8Factory = patchInject(k8Factory, InjectTokens.K8Factory, this.constructor.name);
  }

  /**
   * Check if cert-manager is installed inside any namespace.
   * @returns if cert-manager is found
   */
  public async isCertManagerInstalled(): Promise<boolean> {
    try {
      const pods: Pod[] = await this.k8Factory.default().pods().listForAllNamespaces(['app=cert-manager']);

      return pods.length > 0;
    } catch (error) {
      this.logger.error('Failed to find cert-manager:', error);

      return false;
    }
  }

  /**
   * Check if minio is installed inside the namespace.
   * @returns if minio is found
   */
  public async isMinioInstalled(namespace: NamespaceName): Promise<boolean> {
    try {
      // TODO DETECT THE OPERATOR
      const pods: Pod[] = await this.k8Factory.default().pods().list(namespace, ['app=minio']);

      return pods.length > 0;
    } catch (error) {
      this.logger.error('Failed to find minio:', error);

      return false;
    }
  }

  /**
   * Check if the ingress controller is installed inside any namespace.
   * @returns if ingress controller is found
   */
  public async isIngressControllerInstalled(): Promise<boolean> {
    try {
      const ingressClassList: IngressClass[] = await this.k8Factory.default().ingressClasses().list();

      return ingressClassList.length > 0;
    } catch (error) {
      this.logger.error('Failed to find ingress controller:', error);

      return false;
    }
  }

  /**
   * Check if the remote config is installed inside any namespace.
   * @returns if remote config is found
   */
  public async isRemoteConfigPresentInAnyNamespace() {
    try {
      const configmaps: ConfigMap[] = await this.k8Factory
        .default()
        .configMaps()
        .listForAllNamespaces([constants.SOLO_REMOTE_CONFIGMAP_LABEL_SELECTOR]);

      return configmaps.length > 0;
    } catch (error) {
      this.logger.error('Failed to find remote config:', error);

      return false;
    }
  }

  /**
   * Check if the prometheus is installed inside the namespace.
   * @param namespace - namespace where to search
   * @returns if prometheus is found
   */
  public async isPrometheusInstalled(namespace: NamespaceName) {
    try {
      const pods: Pod[] = await this.k8Factory.default().pods().list(namespace, ['app.kubernetes.io/name=prometheus']);

      return pods.length > 0;
    } catch (error) {
      this.logger.error('Failed to find prometheus:', error);

      return false;
    }
  }

  /**
   * Searches specific namespace for remote config's config map
   *
   * @param namespace - namespace where to search
   * @returns true if found else false
   */
  public async isRemoteConfigPresentInNamespace(namespace: NamespaceName): Promise<boolean> {
    try {
      const configmaps: ConfigMap[] = await this.k8Factory
        .default()
        .configMaps()
        .list(namespace, [constants.SOLO_REMOTE_CONFIGMAP_LABEL_SELECTOR]);

      return configmaps.length > 0;
    } catch (error) {
      this.logger.error('Failed to find remote config:', error);

      return false;
    }
  }
}
