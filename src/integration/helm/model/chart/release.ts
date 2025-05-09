// SPDX-License-Identifier: Apache-2.0

import {type ChartInfo} from './chart-info.js';
import {type ReleaseInfo} from './release-info.js';

export class Release {
  constructor(
    public readonly name: string,
    public readonly info: ReleaseInfo,
    public readonly chart: ChartInfo,
  ) {}
}
