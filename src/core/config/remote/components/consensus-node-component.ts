// SPDX-License-Identifier: Apache-2.0

import {BaseComponent} from './base-component.js';
import {SoloError} from '../../../errors/solo-error.js';
import {ComponentTypes} from '../enumerations/component-types.js';
import {ConsensusNodeStates} from '../enumerations/consensus-node-states.js';
import {isValidEnum} from '../../../util/validation-helpers.js';
import {type ClusterReference, type ComponentName, type NamespaceNameAsString} from '../../../../types/index.js';
import {type ToObject} from '../../../../types/index.js';
import {type ConsensusNodeComponentStruct} from './interfaces/consensus-node-component-struct.js';

/**
 * Represents a consensus node component within the system.
 *
 * A `ConsensusNodeComponent` extends the functionality of `BaseComponent` and includes additional properties and behaviors
 * specific to consensus nodes, such as maintaining and validating the node's state.
 */
export class ConsensusNodeComponent
  extends BaseComponent
  implements ConsensusNodeComponentStruct, ToObject<ConsensusNodeComponentStruct>
{
  /**
   * @param name - the name to distinguish components.
   * @param nodeId - node id of the consensus node
   * @param cluster - associated to component
   * @param namespace - associated to component
   * @param state - of the consensus node
   */
  public constructor(
    name: ComponentName,
    cluster: ClusterReference,
    namespace: NamespaceNameAsString,
    public readonly state: ConsensusNodeStates,
    public readonly nodeId: number,
  ) {
    super(ComponentTypes.ConsensusNode, name, cluster, namespace);

    this.validate();
  }

  /* -------- Utilities -------- */

  /** Handles creating instance of the class from plain object. */
  public static fromObject(component: ConsensusNodeComponentStruct): ConsensusNodeComponent {
    const {name, cluster, namespace, state, nodeId} = component;
    return new ConsensusNodeComponent(name, cluster, namespace, state, nodeId);
  }

  public override validate(): void {
    super.validate();

    if (!isValidEnum(this.state, ConsensusNodeStates)) {
      throw new SoloError(`Invalid consensus node state: ${this.state}`);
    }

    if (typeof this.nodeId !== 'number') {
      throw new SoloError(`Invalid node id. It must be a number: ${this.nodeId}`);
    }

    if (this.nodeId < 0) {
      throw new SoloError(`Invalid node id. It cannot be negative: ${this.nodeId}`);
    }
  }

  public override toObject(): ConsensusNodeComponentStruct {
    return {
      ...super.toObject(),
      state: this.state,
      nodeId: this.nodeId,
    };
  }
}
