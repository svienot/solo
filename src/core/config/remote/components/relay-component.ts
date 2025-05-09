// SPDX-License-Identifier: Apache-2.0

import {SoloError} from '../../../errors/solo-error.js';
import {BaseComponent} from './base-component.js';
import {ComponentTypes} from '../enumerations/component-types.js';
import {type ClusterReference, type ComponentName, type NamespaceNameAsString} from '../../../../types/index.js';
import {type NodeAliases} from '../../../../types/aliases.js';
import {type ToObject} from '../../../../types/index.js';
import {type RelayComponentStruct} from './interfaces/relay-component-struct.js';

export class RelayComponent extends BaseComponent implements RelayComponentStruct, ToObject<RelayComponentStruct> {
  /**
   * @param name - to distinguish components.
   * @param clusterReference - in which the component is deployed.
   * @param namespace - associated with the component.
   * @param consensusNodeAliases - list node aliases
   */
  public constructor(
    name: ComponentName,
    clusterReference: ClusterReference,
    namespace: NamespaceNameAsString,
    public readonly consensusNodeAliases: NodeAliases = [],
  ) {
    super(ComponentTypes.Relay, name, clusterReference, namespace);
    this.validate();
  }

  /* -------- Utilities -------- */

  /** Handles creating instance of the class from plain object. */
  public static fromObject(component: RelayComponentStruct): RelayComponent {
    const {name, cluster, namespace, consensusNodeAliases} = component;
    return new RelayComponent(name, cluster, namespace, consensusNodeAliases);
  }

  public override validate(): void {
    super.validate();

    for (const nodeAlias of this.consensusNodeAliases) {
      if (!nodeAlias || typeof nodeAlias !== 'string') {
        throw new SoloError(`Invalid consensus node alias: ${nodeAlias}, aliases ${this.consensusNodeAliases}`);
      }
    }
  }

  public override toObject(): RelayComponentStruct {
    return {
      consensusNodeAliases: this.consensusNodeAliases,
      ...super.toObject(),
    };
  }
}
