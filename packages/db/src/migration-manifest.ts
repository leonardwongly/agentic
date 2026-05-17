export type CheckedInMigration = {
  name: string;
  checksum: string;
};

export const CHECKED_IN_MIGRATIONS: readonly CheckedInMigration[] = [
  {
    name: "0001_init.sql",
    checksum: "5f39f0c41fc16f7238327b6c463dfbab52ddfc85dd05ecadb19dc36c52fa46bf"
  },
  {
    name: "0002_job_execution_journal.sql",
    checksum: "82bfafe57ce86cc53d278f2ec1f2875b16490444c4f80b55297b005120ce36dc"
  },
  {
    name: "0003_goal_contract.sql",
    checksum: "638e53e375b7edca5aaca92af7d96194485d43a968a551e462d2e2d9bca38dd9"
  },
  {
    name: "0004_team_responsibility.sql",
    checksum: "0be3370bf01252abf5fe1fb56914df5480765292fdb14fa55b040f0c6ea74677"
  },
  {
    name: "0004_workspace_shadow_replay_policy.sql",
    checksum: "4f8ab26e988197dbcb8cd82543a8a9f1ec2bd8f58f7d551e4fa94d1dfde9bb93"
  },
  {
    name: "0005_bundle_child_sort_order.sql",
    checksum: "9e2684b968cbce5907aba99a1d896c4a4c469fa5a5dd16693c460221518cf3fa"
  },
  {
    name: "0005_governance_default_deny.sql",
    checksum: "9567afb6203e41a95facbba90a45934256960637627e6623648b309296d57b8f"
  },
  {
    name: "0006_watcher_scheduler.sql",
    checksum: "a68bd1318cb6996191d268fcbb5c135351e31aabd5a2bdd5e737f6a2b5039078"
  },
  {
    name: "0007_goal_share_disclosure_review.sql",
    checksum: "171735c613b7c86a4065815760290e585c0b2cdc33b6ef3f697726df60d72830"
  },
  {
    name: "0008_shared_auth_runtime_state.sql",
    checksum: "ab63cc305324ac9fd09e10f7604a5b5f9505d06941e9b8fa43eeff71f565f9a5"
  },
  {
    name: "0009_job_scheduling_controls.sql",
    checksum: "3dfd55e1067c2174dea6328fbecd27b6d0be675eabcc65027c323f80b1ac78f1"
  },
  {
    name: "0010_provider_side_effect_ledger.sql",
    checksum: "882ace56f1dce3a10e729ef975b50c9ef3289dd8a6af9c1b4108c44fea542ca1"
  }
] as const;
