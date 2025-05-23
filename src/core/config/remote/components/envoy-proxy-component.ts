// SPDX-License-Identifier: Apache-2.0

import {BaseComponent} from './base-component.js';
import {ComponentTypes} from '../enumerations/component-types.js';
import {type ClusterReference, type ComponentName, type NamespaceNameAsString} from '../../../../types/index.js';
import {type BaseComponentStruct} from './interfaces/base-component-struct.js';

export class EnvoyProxyComponent extends BaseComponent {
  public constructor(name: ComponentName, cluster: ClusterReference, namespace: NamespaceNameAsString) {
    super(ComponentTypes.EnvoyProxy, name, cluster, namespace);
    this.validate();
  }

  /* -------- Utilities -------- */

  /** Handles creating instance of the class from plain object. */
  public static fromObject(component: BaseComponentStruct): EnvoyProxyComponent {
    const {name, cluster, namespace} = component;
    return new EnvoyProxyComponent(name, cluster, namespace);
  }
}
