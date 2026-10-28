/** A role + scope pairing the signed-in user can operate under. */
export interface Workspace {
  id: string;
  /** Backend role id this workspace maps to (used by /auth/select-role). */
  roleId?: number;
  /** Organisation unit, e.g. 'London Branch'. */
  branch: string;
  /** Role held in that unit, e.g. 'Sales / BDM'. */
  role: string;
  /** Data visibility description shown under the branch name. */
  scope: string;
  /** Human readable last-access stamp. */
  lastAccessed: string;
}
