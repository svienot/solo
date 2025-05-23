// SPDX-License-Identifier: Apache-2.0

import {type PodName} from './pod-name.js';
import {type NamespaceName} from '../../../../types/namespace/namespace-name.js';
import {ResourceReference} from '../resource-reference.js';

/**
 * Represents a Kubernetes pod reference which includes the namespace name and pod name.
 */
export class PodReference extends ResourceReference<PodName> {
  private constructor(namespace: NamespaceName, name: PodName) {
    super(namespace, name);
  }

  /**
   * Creates a pod reference.
   * @param namespace The namespace name.
   * @param podName The pod name.
   */
  public static of(namespace: NamespaceName, podName: PodName): PodReference {
    return new PodReference(namespace, podName);
  }
}
